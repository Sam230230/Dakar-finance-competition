from __future__ import annotations

import argparse
import json
import logging
import re
from datetime import date
from functools import lru_cache

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

from .common import VECTOR_DIR

logger = logging.getLogger(__name__)


def money_krw(value: int) -> str:
    if value >= 100_000_000:
        return f"{value / 100_000_000:g}억원"
    if value >= 10_000:
        return f"{value / 10_000:g}만원"
    return f"{value:,}원"


def is_region_allowed(meta: dict, user_region: str) -> bool:
    scope = meta.get("region_scope_derived")
    if scope == "타지역":
        return False
    if scope in {"전국_또는_지역미지정", "서울_공통"}:
        return True
    if scope == "서울_자치구":
        return user_region in (meta.get("districts_derived") or [])
    return False


def is_target_allowed(meta: dict) -> bool:
    return bool(meta.get("is_small_business_candidate_derived"))


FINANCIAL_POLICY_KEYWORDS = [
    "융자", "육성기금", "정책자금", "시설자금", "운전자금",
    "경영안정자금", "특례보증", "신용보증", "이차보전",
    "대출이자", "이자지원", "시설개선자금",
]


def is_financial_policy(meta: dict, text: str) -> bool:
    parts = [
        meta.get("name", ""),
        meta.get("category", ""),
        meta.get("support_type", ""),
        meta.get("fund_use", ""),
        meta.get("target_raw", ""),
        meta.get("summary", ""),
    ]
    if meta.get("source_dataset") == "seoul_district_policy":
        parts.append(text or "")
    haystack = " ".join(str(x) for x in parts if x)
    return any(keyword in haystack for keyword in FINANCIAL_POLICY_KEYWORDS)


# LIPS류 투자연계/창업특화 프로그램처럼 일반적인 점포 이전 자금 수요와는
# 결이 다른 특수 정책. 일반 금융정책이 충분할 때는 상위 노출에서 제외한다.
SPECIAL_FINANCE_KEYWORDS = [
    "LIPS", "투자연계", "창업특화", "선투자", "액셀러레이터", "엑셀러레이터",
    "엔젤투자", "TIPS", "예비유니콘", "초격차", "딥테크", "스케일업",
]


def _policy_text_haystack(meta: dict, text: str) -> str:
    parts = [
        meta.get("name", ""),
        meta.get("category", ""),
        meta.get("support_type", ""),
        meta.get("fund_use", ""),
        meta.get("target_raw", ""),
        meta.get("summary", ""),
        text or "",
    ]
    return " ".join(str(x) for x in parts if x)


def is_special_finance(meta: dict, text: str) -> bool:
    haystack = _policy_text_haystack(meta, text)
    return any(keyword in haystack for keyword in SPECIAL_FINANCE_KEYWORDS)


SLOT_ORDER = ["local", "seoul", "national"]
SLOT_LABELS = {"local": "해당 자치구", "seoul": "서울 공통", "national": "전국"}


def slot_for(meta: dict, user_region: str) -> str | None:
    scope = meta.get("region_scope_derived")
    if scope == "서울_자치구" and user_region in (meta.get("districts_derived") or []):
        return "local"
    if scope == "서울_공통":
        return "seoul"
    if scope == "전국_또는_지역미지정":
        return "national"
    return None


def slot_quota(topk: int) -> dict:
    quota = {
        "local": round(topk * 2 / 5),
        "seoul": round(topk * 1 / 5),
        "national": round(topk * 2 / 5),
    }
    quota["national"] += topk - sum(quota.values())
    return quota


def assign_slots(candidates: list[dict], region: str, topk: int) -> list[dict]:
    buckets: dict[str, list[dict]] = {"local": [], "seoul": [], "national": []}
    for cand in candidates:
        slot = slot_for(cand["metadata"], region)
        if slot:
            buckets[slot].append(cand)
    for bucket in buckets.values():
        # 일반 금융정책을 항상 먼저 배치하고, 특수정책(LIPS 등)은 일반 정책이
        # 부족해 quota가 남을 때만 보조적으로 채운다. 유사도 점수 자체는 건드리지 않는다.
        bucket.sort(key=lambda c: (bool(c.get("is_special_finance")), -c["score"]))

    quota = slot_quota(topk)
    take_count = {slot: min(quota[slot], len(buckets[slot])) for slot in SLOT_ORDER}
    remaining = topk - sum(take_count.values())
    if remaining > 0:
        for slot in SLOT_ORDER:
            extra = min(remaining, len(buckets[slot]) - take_count[slot])
            take_count[slot] += extra
            remaining -= extra
            if remaining <= 0:
                break

    ordered: list[dict] = []
    for slot in SLOT_ORDER:
        for cand in buckets[slot][:take_count[slot]]:
            item = dict(cand)
            item["slot"] = slot
            ordered.append(item)
    return ordered


def source_priority(meta: dict) -> int:
    if meta.get("source_dataset") == "seoul_district_policy":
        grade = meta.get("source_grade")
        if grade == "A":
            return 0
        if grade == "B":
            return 1
        return 2  # C 또는 미확인 등급 — 동일 정책 계열 dedup 시 A/B보다 후순위
    if meta.get("chunk_type") == "official_pdf":
        return 3
    return 4


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", "", name or "")


# 회차/분기/연도 표현을 제거해 같은 정책 계열(family)인지 비교할 때 쓰는 이름.
# 예: "2026 상반기 중소기업육성기금" / "2026 하반기 중소기업육성기금" → "중소기업육성기금"
_ROUND_TOKEN_RE = re.compile(r"(19|20)\d{2}\s*년?|상반기|하반기|[1-4]\s*(?:사)?분기|제?\s*\d+\s*차")


def family_key(name: str) -> str:
    return normalize_name(_ROUND_TOKEN_RE.sub("", name or ""))


def same_policy_name(name_a: str, name_b: str) -> bool:
    if not name_a or not name_b:
        return False
    if name_a in name_b or name_b in name_a:
        return True
    fam_a, fam_b = family_key(name_a), family_key(name_b)
    if not fam_a or not fam_b:
        return False
    # "[서울] 관악구 2026년 상반기 OO 융자지원 계획 공고" vs "2026년 하반기 OO 융자지원"처럼
    # 출처마다 붙는 접두/접미 문구가 달라도 핵심 정책명이 포함관계면 같은 계열로 본다.
    # same_policy_name은 항상 같은 지역범위 그룹 안에서만 호출되므로 다른 자치구 정책과 섞이지 않는다.
    return fam_a == fam_b or fam_a in fam_b or fam_b in fam_a


_PERIOD_DATE_RE = re.compile(r"(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})")


def recency_key(meta: dict) -> tuple:
    """같은 정책 계열 안에서 가장 최신 회차를 고르기 위한 정렬 키.
    회차 표기(연도/상반기·하반기/분기)를 우선하고, 없으면 신청기간의 시작일로 대체한다."""
    name = meta.get("name") or ""
    year_match = re.search(r"(20\d{2})", name)
    year = int(year_match.group(1)) if year_match else 0
    half = 2 if "하반기" in name else 1 if "상반기" in name else 0
    quarter_match = re.search(r"([1-4])\s*(?:사)?분기", name)
    quarter = int(quarter_match.group(1)) if quarter_match else 0

    period = meta.get("application_period") or ""
    date_match = _PERIOD_DATE_RE.search(period)
    start_ordinal = 0
    if date_match:
        try:
            y, m, d = (int(x) for x in date_match.groups())
            start_ordinal = date(y, m, d).toordinal()
        except ValueError:
            start_ordinal = 0

    return (year, half, quarter, start_ordinal)


def exact_key(meta: dict) -> str:
    return normalize_name(meta.get("name") or meta.get("policy_id") or meta.get("url") or "")


def _scope_signature(meta: dict) -> tuple:
    districts = meta.get("districts_derived") or []
    if districts:
        return ("district", tuple(sorted(districts)))
    return ("scope", meta.get("region_scope_derived"))


def _group_by_scope(candidates: list[dict]) -> dict[tuple, list[dict]]:
    groups: dict[tuple, list[dict]] = {}
    for cand in candidates:
        groups.setdefault(_scope_signature(cand["metadata"]), []).append(cand)
    return groups


def region_label(meta: dict) -> str:
    scope = meta.get("region_scope_derived")
    if scope == "전국_또는_지역미지정":
        return "전국"
    if scope == "서울_공통":
        return "서울 공통"
    if scope == "서울_자치구":
        return ", ".join(meta.get("districts_derived", [])) or "서울 자치구"
    return scope or "확인불가"


def build_query(
    industry: str,
    region: str,
    fund: int,
    relocation_type: str | None = None,
    operating_status: str | None = None,
) -> str:
    context = []
    if relocation_type:
        context.append(f"이전유형은 {relocation_type} 이전")
    if operating_status:
        context.append(f"현재 상태는 {operating_status}")
    extra = ". ".join(context)
    if extra:
        extra += ". "
    return (
        f"서울 {region} 후보지로 이전을 검토하는 {industry} 소상공인. "
        f"{extra}Rule Engine에서 계산된 추가 필요 이전자금은 {money_krw(fund)}. "
        "점포 이전, 시설자금, 운전자금, 경영안정자금, 정책자금, 융자, "
        "보증, 이차보전 중 현재 상황과 관련성이 높은 공식 정책지원."
    )


@lru_cache(maxsize=1)
def _load_runtime():
    index_path = VECTOR_DIR / "policy.index"
    metadata_path = VECTOR_DIR / "metadata.json"
    if not index_path.exists() or not metadata_path.exists():
        raise RuntimeError("정책 Vector Index가 없습니다. policy_rag/vector_db를 확인하세요.")
    index = faiss.read_index(str(index_path))
    with metadata_path.open("r", encoding="utf-8") as f:
        store = json.load(f)
    model = SentenceTransformer(store["embedding_model"])
    return index, store, model


# 사용자 입력값(재무정보)만으로는 검증할 수 없는 자격조건 키워드.
# 이 중 하나라도 안내문에 등장하면 "신청 가능"이 아니라 "자격 추가 확인 필요"로 보수적으로 표시한다.
ELIGIBILITY_CONDITION_KEYWORDS = [
    "업력", "사업자등록", "신용등급", "신용조건", "신용점수", "담보", "보증인",
    "매출액", "매출조건", "사업자 형태", "법인사업자", "개인사업자",
    "별도 심사", "심의", "제외업종", "지원제외", "선정평가", "가점",
]

# "해당 자치구/관내에서 사업자등록 후 N개월/년" 류의 지역 사업기간 조건.
# 이전을 검토 중인 사용자는 아직 그 기간을 채우지 못했을 수 있으므로 즉시 충족으로 판단하지 않는다.
_DISTRICT_TENURE_RE = re.compile(
    r"(관내|해당\s*자치구|해당\s*구|해당\s*지역)[^.]{0,20}(사업자등록|영업|입주)|"
    r"사업자등록[^.]{0,10}(개월|년)\s*(이상|경과)"
)


def _eligibility_haystack(meta: dict, text: str) -> str:
    parts = [
        meta.get("target_raw", ""),
        meta.get("summary", ""),
        meta.get("business_age_requirement", ""),
        meta.get("amount_limit", ""),
        meta.get("interest_rate", ""),
        meta.get("fund_use", ""),
        meta.get("support_type", ""),
        meta.get("category", ""),
        text or "",
    ]
    return " ".join(str(x) for x in parts if x)


def _has_district_tenure_condition(haystack: str) -> bool:
    return bool(_DISTRICT_TENURE_RE.search(haystack))


def _needs_eligibility_check(meta: dict, text: str = "") -> bool:
    if meta.get("eligibility_needs_check"):
        return True
    # 정보가 구조화되지 않은 기업마당/PDF 결과는 실제 신청 전 조건 확인이 필요하다.
    important = [
        meta.get("business_age_requirement"),
        meta.get("amount_limit"),
        meta.get("interest_rate"),
    ]
    if any(not value for value in important):
        return True
    # 구조화된(seoul_district_policy) 항목이라도 업력/신용/담보 등 조건 문구가 있으면
    # 사용자의 현재 입력값만으로는 충족 여부를 확정할 수 없다 — 보수적으로 확인 필요 처리.
    haystack = _eligibility_haystack(meta, text)
    return any(keyword in haystack for keyword in ELIGIBILITY_CONDITION_KEYWORDS)


_STATUS_DATE_RE = re.compile(r"(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})")


def compute_application_status(period_text: str | None, today: date | None = None) -> str:
    """신청기간 문구 + 오늘 날짜(date.today() 기준, 하드코딩 금지)로 신청상태 배지를 계산한다."""
    today = today or date.today()
    text = (period_text or "").strip()
    if not text or text in {"확인 필요", "-"}:
        return "신청기간 확인 필요"

    dates: list[date] = []
    for match in _STATUS_DATE_RE.finditer(text):
        y, m, d = (int(x) for x in match.groups())
        try:
            dates.append(date(y, m, d))
        except ValueError:
            continue

    has_budget_phrase = "소진" in text or "예산" in text

    if len(dates) >= 2:
        start, end = dates[0], dates[1]
        if today < start:
            return "접수 예정"
        if today == end:
            return "오늘 마감"
        if today > end:
            return "마감"
        return "접수 중"

    if len(dates) == 1:
        start = dates[0]
        if today < start:
            return "접수 예정"
        if has_budget_phrase:
            return "예산 소진 여부 확인 필요"
        return "접수 중"

    if has_budget_phrase:
        return "예산 소진 여부 확인 필요"

    return "신청기간 확인 필요"


def retrieve(
    industry: str,
    region: str,
    fund: int,
    topk: int = 5,
    relocation_type: str | None = None,
    operating_status: str | None = "영업 중",
):
    index, store, model = _load_runtime()
    chunks = store["chunks"]
    query = build_query(industry, region, fund, relocation_type, operating_status)

    vector = model.encode([query], convert_to_numpy=True, normalize_embeddings=True).astype("float32")
    scores, ids = index.search(vector, index.ntotal)

    candidates = []
    for score, idx in zip(scores[0], ids[0]):
        if idx < 0:
            continue
        row = chunks[idx]
        meta = row["metadata"]
        if not is_target_allowed(meta):
            continue
        if not is_region_allowed(meta, region):
            continue
        if not is_financial_policy(meta, row["text"]):
            continue
        candidates.append({
            "score": float(score),
            "text": row["text"],
            "metadata": meta,
            "_priority": source_priority(meta),
            "is_special_finance": is_special_finance(meta, row["text"]),
        })

    def better(a: dict, b: dict) -> dict:
        # 동일 정책 계열(family)로 클러스터링된 후보끼리는 최신 회차를 우선한다.
        recency_a, recency_b = recency_key(a["metadata"]), recency_key(b["metadata"])
        if recency_a != recency_b:
            return a if recency_a > recency_b else b
        if a["_priority"] != b["_priority"]:
            return a if a["_priority"] < b["_priority"] else b
        return a if a["score"] >= b["score"] else b

    # 동일 지역범위(같은 자치구 / 서울 공통 / 전국) 안에서만 정책 계열을 비교해
    # 서로 다른 자치구·범위의 정책이 잘못 합쳐지지 않게 한다.
    merged: dict[str, dict] = {}
    for scope, group in _group_by_scope(candidates).items():
        clusters: list[list[dict]] = []
        for cand in group:
            name = cand["metadata"].get("name", "")
            for cluster in clusters:
                if same_policy_name(name, cluster[0]["metadata"].get("name", "")):
                    cluster.append(cand)
                    break
            else:
                clusters.append([cand])
        for cluster in clusters:
            best = cluster[0]
            for cand in cluster[1:]:
                best = better(best, cand)
            key = f"{scope}::{normalize_name(best['metadata'].get('name', ''))}"
            merged[key] = best

    ranked = assign_slots(list(merged.values()), region, topk)
    for row in ranked:
        row.pop("_priority", None)
        text = row.get("text", "")
        row["eligibility_needs_check"] = _needs_eligibility_check(row["metadata"], text)
        row["district_tenure_note"] = _has_district_tenure_condition(_eligibility_haystack(row["metadata"], text))
    return query, ranked


SOURCE_GRADE_NOTES = {
    "A": "공식 자치구 원공고",
    "B": "기업마당 등 공식 중계",
    "C": "최신 사업은 확인했으나 자치구 공식 원공고 추가 확인 필요",
}


def compact_result(result: dict) -> dict:
    meta = result["metadata"]
    eligibility_needs_check = bool(result.get("eligibility_needs_check"))
    if result.get("district_tenure_note"):
        eligibility_note = "이전 후 지역 사업기간 요건 확인 필요"
    elif eligibility_needs_check:
        eligibility_note = "자격 추가 확인 필요"
    else:
        eligibility_note = "검토 가능"
    source_grade = meta.get("source_grade")
    return {
        "name": meta.get("name", ""),
        "region_slot": SLOT_LABELS.get(result.get("slot"), region_label(meta)),
        "region_scope": region_label(meta),
        "agency": meta.get("agency", ""),
        "target": meta.get("target_raw", ""),
        "support_type": meta.get("support_type") or meta.get("category") or "확인 필요",
        "fund_use": meta.get("fund_use") or "확인 필요",
        "business_age_requirement": meta.get("business_age_requirement") or "확인 필요",
        "amount_limit": meta.get("amount_limit") or "확인 필요",
        "interest_rate": meta.get("interest_rate") or "확인 필요",
        "application_period": meta.get("application_period") or "확인 필요",
        "application_status": compute_application_status(meta.get("application_period")),
        "eligibility_needs_check": eligibility_needs_check,
        "eligibility_note": eligibility_note,
        "is_special_finance": bool(result.get("is_special_finance")),
        "source_grade": source_grade,
        # C등급(원공고 미확보)은 검색에는 포함하되 확정 근거로 쓰지 않도록
        # 프론트에서 "출처 추가 확인 필요" 배지로 구분하기 위한 플래그.
        "source_verification_needed": bool(meta.get("source_verification_needed")),
        "source_note": SOURCE_GRADE_NOTES.get(source_grade, ""),
        "url": meta.get("url", ""),
        "score": round(float(result["score"]), 4),
        "evidence": result.get("text", "")[:500],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--industry", default="카페")
    parser.add_argument("--region", default="강남구")
    parser.add_argument("--fund", type=int, default=18_000_000)
    parser.add_argument("--topk", type=int, default=5)
    parser.add_argument("--type", dest="relocation_type", default="자발적")
    args = parser.parse_args()

    query, results = retrieve(
        industry=args.industry,
        region=args.region,
        fund=args.fund,
        topk=args.topk,
        relocation_type=args.relocation_type,
    )
    print("\n=== RAG 검색 Query ===")
    print(query)
    print("\n=== 검색 결과 ===")
    for rank, result in enumerate(results, 1):
        item = compact_result(result)
        print(f"\n[{rank}] {item['name']}")
        print(f"지역 슬롯: {item['region_slot']}")
        print(f"기관: {item['agency']}")
        print(f"지원유형: {item['support_type']}")
        print(f"자금용도: {item['fund_use']}")
        print(f"업력요건: {item['business_age_requirement']}")
        print(f"지원한도: {item['amount_limit']}")
        print(f"금리: {item['interest_rate']}")
        print(f"신청기간: {item['application_period']} ({item['application_status']})")
        print(f"자격상태: {item['eligibility_note']}")
        print(f"유사도: {item['score']:.4f}")
        print(f"공식 공고: {item['url']}")


if __name__ == "__main__":
    main()
