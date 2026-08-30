from __future__ import annotations

import re
from pathlib import Path

from pypdf import PdfReader

from common import PROCESSED_DIR, ROOT, read_jsonl, write_jsonl
from normalize_bizinfo import SMALL_BUSINESS_TARGET_PATTERN

CHUNK_SIZE = 1200
CHUNK_OVERLAP = 180

DISTRICT_JSONL_PATH = (
    ROOT / "data" / "raw" / "district" / "seoul_25gu_policy_corpus_2026-08-26.jsonl"
)

def normalize_ws(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    text = normalize_ws(text)
    if not text:
        return []
    if len(text) <= size:
        return [text]

    chunks = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))

        # 문단/문장 경계가 근처에 있으면 거기서 자름.
        if end < len(text):
            window = text[start:end]
            candidates = [
                window.rfind("\n\n"),
                window.rfind(". "),
                window.rfind("다. "),
            ]
            cut = max(candidates)
            if cut > size * 0.55:
                end = start + cut + 1

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks

def pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            pages.append("")
    return "\n\n".join(pages)

def api_record_text(row: dict) -> str:
    districts = ", ".join(row.get("districts_derived", [])) or "확인되지 않음"
    hits = ", ".join(row.get("small_business_keyword_hits", [])) or "없음"
    parts = [
        f"공고명: {row.get('name', '')}",
        f"소관기관: {row.get('agency', '')}",
        f"수행기관: {row.get('executing_agency', '')}",
        f"지원분야: {row.get('category', '')}",
        f"지원대상(API 원문): {row.get('target_raw', '')}",
        f"신청기간: {row.get('application_period', '')}",
        f"사업개요: {row.get('summary', '')}",
        f"신청방법: {row.get('application_method', '')}",
        f"문의처: {row.get('contact', '')}",
        f"해시태그(API 원문): {row.get('hashtags_raw', '')}",
        f"서울 자치구 파생값: {districts}",
        f"소상공인 관련 키워드 파생값: {hits}",
        f"공식 공고 URL: {row.get('url', '')}",
    ]
    return "\n".join(parts)

def district_policy_id(meta: dict) -> str:
    # 기업마당 policy_id(PBLN_...)와 겹치지 않는 안정적인 자치구 정책 ID.
    slug = re.sub(r"\s+", "", meta.get("policy_name", ""))
    return f"DISTRICT_{meta.get('district', '')}_{slug}"

def cafe_eligibility_status(cafe_relevance: str) -> tuple[bool, bool]:
    # (excluded, eligibility_needs_check) 반환.
    if "낮음" in cafe_relevance or "부적합" in cafe_relevance:
        return True, False
    if "확인 필요" in cafe_relevance or "조건부" in cafe_relevance:
        return False, True
    return False, False

def build_district_chunks() -> list[dict]:
    # 서울 25개 자치구 정책 JSONL (기업마당 API/PDF와 별도 출처).
    if not DISTRICT_JSONL_PATH.exists():
        return []

    chunks = []
    for row in read_jsonl(DISTRICT_JSONL_PATH):
        meta = row.get("metadata", {})

        # source_grade C(공식 원공고 미확보)도 검색 대상에는 포함한다.
        # 다만 확정 근거로 쓰지 않도록 source_verification_needed=True로 표시해
        # retrieve.py/프론트에서 "출처 추가 확인 필요" 배지로 구분한다.
        excluded, needs_check = cafe_eligibility_status(meta.get("cafe_relevance", ""))
        if excluded:
            continue

        target_summary = meta.get("target_summary", "")
        district = meta.get("district", "")

        chunk_meta = {
            "policy_id": district_policy_id(meta),
            "name": meta.get("policy_name", ""),
            "agency": meta.get("source_type", ""),
            "category": meta.get("support_type", ""),
            "support_type": meta.get("support_type", ""),
            "fund_use": meta.get("fund_use", ""),
            "amount_limit": meta.get("amount_limit", ""),
            "interest_rate": meta.get("interest_rate", ""),
            "business_age_requirement": meta.get("business_age_requirement", ""),
            "application_period": meta.get("application_period", ""),
            "target_raw": target_summary,
            "districts_derived": [district] if district else [],
            "region_scope_derived": "서울_자치구",
            "is_small_business_candidate_derived": bool(
                SMALL_BUSINESS_TARGET_PATTERN.search(target_summary)
            ),
            "url": meta.get("source_url", ""),
            "source_dataset": "seoul_district_policy",
            "source_grade": meta.get("source_grade", ""),
            "source_verification_needed": meta.get("source_grade") == "C",
            "eligibility_needs_check": needs_check,
        }

        for idx, text in enumerate(chunk_text(row.get("text", ""))):
            chunks.append({
                "text": text,
                "metadata": {
                    **chunk_meta,
                    "chunk_type": "district_policy",
                    "chunk_index": idx,
                },
            })

    return chunks

# ─────────────────────────────────────────────────────────────────────────
# 서울시 "2026년도 서울특별시 중소기업육성자금 융자지원계획 공고"(policy_id
# PBLN_000000000117111)를 프로그램 단위로 분리한다.
#
# 이 표는 새로 지어낸 게 아니라, 이 정책의 official_pdf 청크(policy_rag/data/raw/docs에
# 다운로드된 실제 첨부 PDF에서 추출된 원문, 붙임1 표)에 실제로 있는 숫자를 2026-08-30에
# 수동으로 대조·전사한 것이다 — 아래 PDF 표 레이아웃은 셀 사이 공백이 불규칙해 범용
# 정규식 파서보다 이 방식이 더 정확하다. **이 정책 문서에만 특화된 하드코딩이며 다른
# 문서로 일반화하지 않는다.** 원문 공고가 갱신되면(회차 변경 등) 이 표도 다시 대조해야 한다.
_SEOUL_FINANCE_PARENT_POLICY_ID = "PBLN_000000000117111"

_SEOUL_FINANCE_PROGRAMS = [
    {"program": "시설자금", "amount_limit": "시행규칙 별표3(구조조정·입지지원사업 등)", "interest_rate": "연 2.8%",
     "target": "시행규칙 별표2에 해당하는 서울 소재 중소기업 및 소상공인(구조조정사업, 입지지원사업 등)", "fund_use": "facility"},
    {"program": "성장기반자금", "amount_limit": "5억원 이내", "interest_rate": "연 3.0%",
     "target": "시행규칙 별표1에 해당하는 서울 소재 중소기업 및 소상공인", "fund_use": "working_capital"},
    {"program": "긴급자영업자금", "amount_limit": "5천만원 이내", "interest_rate": "연 2.5%",
     "target": "생계형 영세 자영업자(기초생활수급자·차상위계층·실직자·장애인·여성가장·한부모가정 등) 또는 신청일 기준 매출액이 이전분기·반기 대비 20% 이상 급감/6개월 이내 임차료 30% 이상 상승한 소상공인",
     "fund_use": "working_capital"},
    {"program": "혁신형기업도약자금", "amount_limit": "3억원 이내", "interest_rate": "연 3.0%",
     "target": "기술혁신기업, 경영혁신기업, 서울시 특화산업 분야 및 시책사업 추진 사업자", "fund_use": "working_capital"},
    {"program": "재해중소기업자금", "amount_limit": "2억원 이내", "interest_rate": "연 2.0%",
     "target": "사회재난·자연재해 피해를 입어 자치구 주민센터 등에서 재해 확인(증)을 받은 서울 소재 중소기업·소상공인", "fund_use": "working_capital"},
    {"program": "경제활성화자금", "amount_limit": "5억원 이내", "interest_rate": "이차보전 1.8%(대출일로부터 4년 이내)",
     "target": "시행규칙 별표1에 해당하는 서울 소재 중소기업 및 소상공인", "fund_use": "working_capital"},
    {"program": "포용금융자금", "amount_limit": "3천만원 이내", "interest_rate": "이차보전 1.8%(대출일로부터 4년 이내)",
     "target": "신용평점 839점 이하(구 4등급 이하)인 서울 소재 중소기업·소상공인", "fund_use": "working_capital"},
    {"program": "창업기업자금", "amount_limit": "1억원 이내(일반 5천만원/특화 7천만원/임차 5천만원)", "interest_rate": "이차보전 1.8%(대출일로부터 4년 이내)",
     "target": "서울 소재 창업 후 1년 이내 중소기업·소상공인 중 서울시 지정 창업교육 이수 등 요건 해당자", "fund_use": "working_capital"},
    {"program": "신속드림자금", "amount_limit": "3천만원 이내", "interest_rate": "이차보전 1.8%(대출일로부터 4년 이내)",
     "target": "신용평점 839점 이하 또는 저소득자(연소득 5,900만원 이하)·생계형 영세 자영업자·매출 20% 이상 급감/임차료 30% 이상 상승 기업",
     "fund_use": "working_capital"},
    {"program": "취약사업자지원자금", "amount_limit": "5천만원 이내", "interest_rate": "이차보전 2.5%(대출일로부터 5년 이내)",
     "target": "서울신용보증재단이 지정한 취약사업자", "fund_use": "working_capital"},
    {"program": "서울배달상생자금", "amount_limit": "1억원 이내", "interest_rate": "이차보전 2.0%(대출일로부터 5년 이내)",
     "target": "신한은행 땡겨요 앱으로 3회 이상 주문실적이 있어 '서울배달상생기업'으로 인정된 사업자", "fund_use": "working_capital"},
    {"program": "희망동행자금", "amount_limit": "1억원 이내", "interest_rate": "이차보전 1.8%(대출일로부터 5년 이내)",
     "target": "경영애로 기업 중 서울신용보증재단 보증 또는 타 금융기관 대출을 이용 중인 사업자", "fund_use": "working_capital"},
    {"program": "일자리창출우수기업자금", "amount_limit": "5억원 이내(사회보험가입촉진 대상 5천만원 이내)", "interest_rate": "이차보전 2.5%(대출일로부터 5년 이내)",
     "target": "서울형 강소기업 인증, 상시근로자수 증가, 청년근로자 고용 등 일자리창출 요건 해당 기업", "fund_use": "working_capital"},
    {"program": "ESG자금", "amount_limit": "1억원 이내", "interest_rate": "이차보전 2.5%(대출일로부터 5년 이내)",
     "target": "환경(E)·사회적 책임(S)·지배구조(G) 분야 실천기업", "fund_use": "working_capital"},
    {"program": "재기지원자금", "amount_limit": "1억원 이내", "interest_rate": "이차보전 2.5%(대출일로부터 5년 이내)",
     "target": "성실실패자·재창업자 중 '서울형 다시서기 4.0 프로젝트' 등 참여 소상공인", "fund_use": "working_capital"},
]


def split_seoul_finance_programs(policies: list[dict]) -> list[dict]:
    parent = next((p for p in policies if p.get("policy_id") == _SEOUL_FINANCE_PARENT_POLICY_ID), None)
    if parent is None:
        return []

    chunks = []
    for prog in _SEOUL_FINANCE_PROGRAMS:
        program_slug = re.sub(r"\s+", "", prog["program"])
        program_id = f"{_SEOUL_FINANCE_PARENT_POLICY_ID}_PROGRAM_{program_slug}"
        text = (
            f"프로그램명: {prog['program']} (2026년도 서울특별시 중소기업육성자금 융자지원계획의 세부 프로그램)\n"
            f"소관/수행: 서울특별시 / 서울신용보증재단\n"
            f"지원대상: {prog['target']}\n"
            f"융자한도: {prog['amount_limit']}\n"
            f"금리: {prog['interest_rate']}\n"
            f"공식 공고 URL: {parent.get('url', '')}"
        )
        chunks.append({
            "text": text,
            "metadata": {
                "policy_id": program_id,
                "parent_policy_id": _SEOUL_FINANCE_PARENT_POLICY_ID,
                "parent_policy_name": parent.get("name", ""),
                "name": f"2026년 서울시 중소기업육성자금 - {prog['program']}",
                "agency": "서울특별시(수행: 서울신용보증재단)",
                "category": "융자",
                "support_type": "융자",
                "fund_use": prog["fund_use"] + (" (시설자금)" if prog["fund_use"] == "facility" else " (경영안정/운전자금)"),
                "amount_limit": prog["amount_limit"],
                "interest_rate": prog["interest_rate"],
                "application_period": parent.get("application_period", ""),
                "target_raw": prog["target"],
                "districts_derived": [],
                "region_scope_derived": "서울_공통",
                "is_small_business_candidate_derived": True,
                "url": parent.get("url", ""),
                "source_dataset": "seoul_program_split",
                "source_grade": "A",
                "source_verification_needed": False,
                "chunk_type": "program_split",
                "chunk_index": 0,
            },
        })
    return chunks


def build_corpus() -> list[dict]:
    policies = read_jsonl(PROCESSED_DIR / "policies.jsonl")
    manifest = read_jsonl(PROCESSED_DIR / "doc_manifest.jsonl")

    if not policies:
        raise RuntimeError("policies.jsonl이 없습니다.")

    policy_map = {p["policy_id"]: p for p in policies if p.get("policy_id")}
    doc_map = {}
    for d in manifest:
        if d.get("status") == "ok" and d.get("local_path"):
            doc_map.setdefault(d["policy_id"], []).append(d)

    chunks = []

    for row in policies:
        policy_id = row.get("policy_id", "")
        base_meta = {
            "policy_id": policy_id,
            "name": row.get("name", ""),
            "agency": row.get("agency", ""),
            "category": row.get("category", ""),
            "application_period": row.get("application_period", ""),
            "target_raw": row.get("target_raw", ""),
            "districts_derived": row.get("districts_derived", []),
            "region_scope_derived": row.get("region_scope_derived", ""),
            "is_small_business_candidate_derived": row.get("is_small_business_candidate_derived", False),
            "url": row.get("url", ""),
            "source_dataset": "bizinfo",
            # 기업마당 API/공식 PDF는 공식 중계 출처이므로 추가 출처 확인 배지를 붙이지 않는다.
            "source_verification_needed": False,
            # 기관명/문의처(예: "신용보증재단")가 섞이지 않은 순수 사업개요.
            # 금융정책 키워드 판단은 이 필드만 사용해 기관명 오탐을 막는다.
            "summary": row.get("summary", ""),
        }

        # API 구조화/본문 필드는 항상 corpus에 포함.
        for idx, text in enumerate(chunk_text(api_record_text(row))):
            chunks.append({
                "text": text,
                "metadata": {
                    **base_meta,
                    "chunk_type": "api",
                    "chunk_index": idx,
                },
            })

        # 공식 출력 PDF/첨부 PDF가 있으면 원문도 corpus에 추가 — 단, 서울시 육성자금
        # 통합공고(PBLN_000000000117111)는 아래에서 프로그램 단위로 대체하므로 여기서는
        # 뭉뚱그려진 페이지 청크를 만들지 않는다(중복 노출 방지).
        if policy_id == _SEOUL_FINANCE_PARENT_POLICY_ID:
            continue
        for doc in doc_map.get(policy_id, []):
            path = ROOT / doc["local_path"]
            if path.suffix.lower() != ".pdf":
                continue
            try:
                text = pdf_text(path)
            except Exception as exc:
                print(f"[PDF 추출 실패] {path.name}: {exc}")
                continue

            for idx, chunk in enumerate(chunk_text(text)):
                chunks.append({
                    "text": chunk,
                    "metadata": {
                        **base_meta,
                        "chunk_type": "official_pdf",
                        "chunk_index": idx,
                        "document_filename": path.name,
                    },
                })

    chunks.extend(split_seoul_finance_programs(policies))
    chunks.extend(build_district_chunks())

    output = PROCESSED_DIR / "chunks.jsonl"
    write_jsonl(output, chunks)
    print(f"[Corpus 생성 완료] {len(chunks)} chunks -> {output}")
    return chunks

if __name__ == "__main__":
    build_corpus()
