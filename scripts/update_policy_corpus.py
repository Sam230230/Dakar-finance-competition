"""Policy RAG corpus 갱신 파이프라인 — 공모전 운영자가 수동으로만 실행한다.

서버 startup이나 /staymove 요청 경로에서는 절대 이 스크립트를 호출하지 않는다.
runtime은 policy_rag/vector_db/의 결과물(policy.index, metadata.json)만 읽는다.

실행:
    python3 scripts/update_policy_corpus.py [--skip-fetch] [--skip-docs]

단계: fetch_bizinfo(라이브 API) -> normalize_bizinfo -> download_policy_docs(PDF)
      -> build_corpus(25구 seed + 서울 프로그램 분리 포함) -> build_vector_index(FAISS)

기존 25구 CSV/JSONL seed는 절대 건드리지 않는다. 실행 전 vector_db를 타임스탬프
백업해 문제가 생기면 되돌릴 수 있게 한다.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "policy_rag" / "src"
VECTOR_DIR = ROOT / "policy_rag" / "vector_db"

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")  # BIZINFO_API_KEY 등 — subprocess는 이 프로세스 env를 상속한다.
except ImportError:
    pass


def run_step(script: str, label: str) -> None:
    print(f"\n=== [{label}] {script} ===")
    result = subprocess.run([sys.executable, script], cwd=SRC)
    if result.returncode != 0:
        raise SystemExit(f"[실패] {script} (exit {result.returncode})")


def backup_vector_db() -> Path | None:
    if not VECTOR_DIR.exists():
        return None
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = VECTOR_DIR.parent / f"vector_db_backup_{stamp}"
    shutil.copytree(VECTOR_DIR, backup)
    print(f"[백업] {VECTOR_DIR} -> {backup}")
    return backup


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-fetch", action="store_true", help="Bizinfo API 재호출 생략(기존 raw 덤프 재사용)")
    parser.add_argument("--skip-docs", action="store_true", help="PDF 재다운로드 생략(기존 문서 재사용)")
    args = parser.parse_args()

    backup_vector_db()

    if not args.skip_fetch:
        run_step("fetch_bizinfo.py", "1/5 Bizinfo API 호출")
    else:
        print("\n[건너뜀] 1/5 Bizinfo API 호출 (--skip-fetch)")

    run_step("normalize_bizinfo.py", "2/5 정규화·dedup")

    if not args.skip_docs:
        run_step("download_policy_docs.py", "3/5 공식 PDF 다운로드")
    else:
        print("\n[건너뜀] 3/5 PDF 다운로드 (--skip-docs)")

    run_step("build_corpus.py", "4/5 corpus 빌드 (25구 seed + 서울 프로그램 분리 포함)")
    run_step("build_vector_index.py", "5/5 FAISS 인덱스 재생성")

    print("\n완료. policy_rag/vector_db/policy.index, metadata.json이 갱신되었습니다.")
    print("서버(uvicorn)를 재시작해야 새 인덱스가 반영됩니다(FAISS는 startup에 1회만 로드).")


if __name__ == "__main__":
    main()
