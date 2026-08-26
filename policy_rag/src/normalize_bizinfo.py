from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from common import (
    PROCESSED_DIR,
    RAW_BIZINFO_DIR,
    SMALL_BUSINESS_TERMS,
    detect_districts,
    get_items,
    keyword_hits,
    safe_text,
    write_jsonl,
)

# 서울 자치구/공통 판정 다음에만 확인하는 타지역 키워드 (기업마당 공고 원문 표현 기준).
OTHER_REGION_KEYWORDS = [
    "부산광역시", "부산",
    "대구광역시", "대구",
    "인천광역시", "인천",
    "광주광역시", "광주",
    "대전광역시", "대전",
    "울산광역시", "울산",
    "세종특별자치시", "세종",
    "경기도", "경기",
    "강원특별자치도", "강원",
    "충청북도", "충북",
    "충청남도", "충남",
    "전북특별자치도", "전북",
    "전라남도", "전남",
    "경상북도", "경북",
    "경상남도", "경남",
    "제주특별자치도", "제주",
]

SEOUL_COMMON_KEYWORDS = ["서울특별시", "[서울]", "서울 소재", "서울시"]

# "소기업"은 "중소기업"의 부분 문자열이라 그냥 in 체크하면 중소기업 전용 공고까지
# 전부 True가 되어버림. "중"으로 시작하지 않는 "소기업"만 인정하도록 lookbehind로 방지.
SMALL_BUSINESS_TARGET_PATTERN = re.compile(r"소상공인|자영업자|자영업|(?<!중)소기업")

def derive_region_scope(region_text: str) -> tuple[str, list[str]]:
    # 우선순위: 서울 자치구 > 서울 공통 > 타지역 > 전국/지역미지정.
    districts = detect_districts(region_text)
    if districts:
        return "서울_자치구", districts
    if any(keyword in region_text for keyword in SEOUL_COMMON_KEYWORDS):
        return "서울_공통", []
    if any(keyword in region_text for keyword in OTHER_REGION_KEYWORDS):
        return "타지역", []
    return "전국_또는_지역미지정", []

def derive_small_business_candidate(target_raw: str, summary: str) -> bool:
    text = f"{target_raw} {summary}"
    return bool(SMALL_BUSINESS_TARGET_PATTERN.search(text))

def normalize_item(item: dict, source_file: str) -> dict:
    policy_id = safe_text(item.get("pblancId") or item.get("seq"))
    name = safe_text(item.get("pblancNm") or item.get("title"))
    url = safe_text(item.get("pblancUrl") or item.get("link"))
    agency = safe_text(item.get("jrsdInsttNm") or item.get("author"))
    executing_agency = safe_text(item.get("excInsttNm"))
    summary = safe_text(item.get("bsnsSumryCn") or item.get("description"))
    category = safe_text(item.get("pldirSportRealmLclasCodeNm") or item.get("lcategory"))
    application_period = safe_text(item.get("reqstBeginEndDe") or item.get("reqstDt"))
    target = safe_text(item.get("trgetNm"))
    hashtags = safe_text(item.get("hashTags"))
    attachment_url = safe_text(item.get("flpthNm"))
    attachment_name = safe_text(item.get("fileNm"))
    print_url = safe_text(item.get("printFlpthNm"))
    print_name = safe_text(item.get("printFileNm"))
    application_method = safe_text(item.get("reqstMthPapersCn"))
    contact = safe_text(item.get("refrncNm"))
    application_url = safe_text(item.get("rceptEngnHmpgUrl"))
    created_at = safe_text(item.get("creatPnttm") or item.get("pubDate"))

    combined = " ".join([
        name, agency, executing_agency, summary, category,
        application_period, target, hashtags, application_method,
    ])
    hits = keyword_hits(combined, SMALL_BUSINESS_TERMS)

    # region_scope_derived / districts_derived는 공고명 + 소관기관 + 수행기관 +
    # 사업개요 + 지원대상 + 해시태그만 사용 (기업마당 공식 컬럼이 아닌 파생값).
    region_text = " ".join([name, agency, executing_agency, summary, target, hashtags])
    region_scope_derived, districts_derived = derive_region_scope(region_text)

    is_small_business_candidate_derived = derive_small_business_candidate(target, summary)

    return {
        "policy_id": policy_id,
        "name": name,
        "url": url,
        "agency": agency,
        "executing_agency": executing_agency,
        "summary": summary,
        "category": category,
        "application_period": application_period,
        "target_raw": target,
        "hashtags_raw": hashtags,
        "attachment_url": attachment_url,
        "attachment_name": attachment_name,
        "print_url": print_url,
        "print_name": print_name,
        "application_method": application_method,
        "contact": contact,
        "application_url": application_url,
        "created_at": created_at,

        # 아래 값들은 기업마당 공식 컬럼이 아니라 우리 서비스 파생값
        "districts_derived": districts_derived,
        "region_scope_derived": region_scope_derived,
        "is_small_business_candidate_derived": is_small_business_candidate_derived,

        # 지원 자격 판정이 아니라 단순 키워드 후보 표시 (참고용, 필터링에는 사용 안 함)
        "small_business_keyword_hits": hits,
        "source_file": source_file,
        "source": "bizinfo",
    }

def normalize_all() -> list[dict]:
    dedup: dict[str, dict] = {}

    files = sorted(RAW_BIZINFO_DIR.glob("*.json"))
    if not files:
        raise RuntimeError(
            "data/raw/bizinfo 안에 API 응답 JSON이 없습니다. fetch_bizinfo.py를 먼저 실행하세요."
        )

    for path in files:
        with path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        for item in get_items(payload):
            row = normalize_item(item, path.name)
            key = row["policy_id"] or row["url"] or row["name"]
            if not key:
                continue

            # 같은 공고가 여러 API 호출 세트에 중복될 수 있어 하나로 합침.
            if key not in dedup:
                dedup[key] = row
            else:
                existing = dedup[key]
                existing["source_file"] = ",".join(
                    sorted(set(existing["source_file"].split(",")) | {path.name})
                )
                existing["districts_derived"] = sorted(
                    set(existing["districts_derived"]) | set(row["districts_derived"])
                )
                existing["small_business_keyword_hits"] = sorted(
                    set(existing["small_business_keyword_hits"])
                    | set(row["small_business_keyword_hits"])
                )
                existing["is_small_business_candidate_derived"] = (
                    existing["is_small_business_candidate_derived"]
                    or row["is_small_business_candidate_derived"]
                )

    rows = list(dedup.values())
    rows.sort(
        key=lambda x: (
            not x["is_small_business_candidate_derived"],
            x["region_scope_derived"] == "타지역",
            x["name"],
        )
    )

    jsonl_path = PROCESSED_DIR / "policies.jsonl"
    write_jsonl(jsonl_path, rows)

    csv_path = PROCESSED_DIR / "policies.csv"
    fieldnames = [
        "policy_id", "name", "agency", "executing_agency",
        "category", "application_period", "target_raw",
        "region_scope_derived", "districts_derived",
        "is_small_business_candidate_derived",
        "small_business_keyword_hits", "summary", "url",
        "print_url", "print_name", "attachment_url", "attachment_name",
        "application_method", "contact", "application_url",
        "created_at", "source_file", "source",
    ]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            out = {k: row.get(k, "") for k in fieldnames}
            out["districts_derived"] = ",".join(row["districts_derived"])
            out["small_business_keyword_hits"] = ",".join(row["small_business_keyword_hits"])
            writer.writerow(out)

    print(f"[정규화 완료] {len(rows)}개 공고")
    print(f"- {jsonl_path}")
    print(f"- {csv_path}")
    return rows

if __name__ == "__main__":
    normalize_all()
