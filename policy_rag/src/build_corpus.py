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

        # 공식 출력 PDF/첨부 PDF가 있으면 원문도 corpus에 추가.
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

    chunks.extend(build_district_chunks())

    output = PROCESSED_DIR / "chunks.jsonl"
    write_jsonl(output, chunks)
    print(f"[Corpus 생성 완료] {len(chunks)} chunks -> {output}")
    return chunks

if __name__ == "__main__":
    build_corpus()
