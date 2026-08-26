from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.parse import unquote

import requests

from common import PROCESSED_DIR, RAW_DOCS_DIR, read_jsonl, write_jsonl

def sanitize_filename(name: str) -> str:
    name = unquote(name or "")
    name = re.sub(r'[\\/:*?"<>|]+', "_", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name[:100] or "document"

def choose_document(row: dict) -> tuple[str, str, str]:
    # 본문 출력파일을 우선 사용.
    if row.get("print_url"):
        return row["print_url"], row.get("print_name") or "print.pdf", "print"
    if row.get("attachment_url"):
        return row["attachment_url"], row.get("attachment_name") or "attachment", "attachment"
    return "", "", ""

def is_download_candidate(row: dict) -> bool:
    # 소상공인 대상이 아니거나 타지역 정책이면 다운로드 대상에서 제외.
    if not row.get("is_small_business_candidate_derived"):
        return False
    return row.get("region_scope_derived") in {
        "전국_또는_지역미지정",
        "서울_공통",
        "서울_자치구",
    }

def candidate_priority(row: dict) -> tuple:
    # 자격 확정용 점수가 아니라 "어떤 문서를 먼저 받아볼지" 정하는 다운로드 우선순위.
    return (
        0 if row.get("region_scope_derived") == "서울_자치구" else
        1 if row.get("region_scope_derived") == "서울_공통" else 2,
        row.get("name", ""),
    )

def download_docs() -> list[dict]:
    rows = read_jsonl(PROCESSED_DIR / "policies.jsonl")
    if not rows:
        raise RuntimeError("policies.jsonl이 없습니다. normalize_bizinfo.py를 먼저 실행하세요.")

    limit = int(os.getenv("DOC_DOWNLOAD_LIMIT", "30"))
    rows = [row for row in rows if is_download_candidate(row)]
    rows = sorted(rows, key=candidate_priority)

    session = requests.Session()
    session.headers.update({"User-Agent": "StayOrMove-RAG-MVP/1.0"})

    manifest = []
    downloaded = 0

    for row in rows:
        if downloaded >= limit:
            break

        url, original_name, source_type = choose_document(row)
        if not url:
            continue

        policy_id = row.get("policy_id") or f"policy_{downloaded+1:03d}"
        clean_name = sanitize_filename(original_name)
        suffix = Path(clean_name).suffix.lower()
        if not suffix:
            suffix = ".pdf"

        local_name = f"{policy_id}_{sanitize_filename(Path(clean_name).stem)}{suffix}"
        local_path = RAW_DOCS_DIR / local_name

        try:
            response = session.get(url, timeout=90, allow_redirects=True)
            response.raise_for_status()

            content_type = response.headers.get("Content-Type", "").lower()
            content = response.content
            if not content:
                raise RuntimeError("빈 파일 응답")

            # PDF 시그니처가 있으면 확장자를 PDF로 교정.
            if content.startswith(b"%PDF") and local_path.suffix.lower() != ".pdf":
                local_path = local_path.with_suffix(".pdf")

            local_path.write_bytes(content)

            manifest.append({
                "policy_id": policy_id,
                "name": row.get("name", ""),
                "url": row.get("url", ""),
                "download_source_url": url,
                "download_source_type": source_type,
                "original_filename": original_name,
                "local_path": str(local_path.relative_to(PROCESSED_DIR.parents[1])),
                "content_type": content_type,
                "bytes": len(content),
                "status": "ok",
            })
            downloaded += 1
            print(f"[문서 저장] {local_path.name}")

        except Exception as exc:
            manifest.append({
                "policy_id": policy_id,
                "name": row.get("name", ""),
                "url": row.get("url", ""),
                "download_source_url": url,
                "download_source_type": source_type,
                "original_filename": original_name,
                "local_path": "",
                "content_type": "",
                "bytes": 0,
                "status": f"error: {exc}",
            })
            print(f"[다운로드 실패] {row.get('name')} -> {exc}")

    manifest_path = PROCESSED_DIR / "doc_manifest.jsonl"
    write_jsonl(manifest_path, manifest)
    print(f"[문서 다운로드 완료] 성공 {downloaded}개 / 로그 {manifest_path}")
    return manifest

if __name__ == "__main__":
    download_docs()
