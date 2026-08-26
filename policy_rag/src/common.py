from __future__ import annotations

import html
import json
import os
import re
from pathlib import Path
from typing import Any, Iterable

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

RAW_BIZINFO_DIR = ROOT / "data" / "raw" / "bizinfo"
RAW_DOCS_DIR = ROOT / "data" / "raw" / "docs"
PROCESSED_DIR = ROOT / "data" / "processed"
VECTOR_DIR = ROOT / "vector_db"

for directory in [RAW_BIZINFO_DIR, RAW_DOCS_DIR, PROCESSED_DIR, VECTOR_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

SEOUL_DISTRICTS = [
    "강남구", "강동구", "강북구", "강서구", "관악구",
    "광진구", "구로구", "금천구", "노원구", "도봉구",
    "동대문구", "동작구", "마포구", "서대문구", "서초구",
    "성동구", "성북구", "송파구", "양천구", "영등포구",
    "용산구", "은평구", "종로구", "중구", "중랑구",
]

SMALL_BUSINESS_TERMS = [
    "소상공인", "자영업자", "자영업", "소기업", "골목상권",
    "경영안정", "운전자금", "시설자금", "육성기금",
    "특례보증", "이차보전", "재기지원", "폐업", "점포",
    "융자", "보증", "정책자금",
]

def env_required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(
            f"{name}가 비어 있습니다. 프로젝트 루트의 .env 파일에 값을 입력하세요."
        )
    return value

def strip_html(value: Any) -> str:
    if value is None:
        return ""
    text = html.unescape(str(value))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def safe_text(value: Any) -> str:
    return strip_html(value)

def get_items(payload: Any) -> list[dict[str, Any]]:
    """
    기업마당 API 응답이 dict 또는 list 형태로 와도
    공고 목록을 정상적으로 추출한다.
    """

    # 1. 응답 자체가 list인 경우
    if isinstance(payload, list):
        results = []

        for item in payload:
            if not isinstance(item, dict):
                continue

            # 실제 공고 데이터가 바로 들어있는 경우
            if "pblancId" in item or "pblancNm" in item:
                results.append(item)

            # list 안에 jsonArray / item 구조가 또 있는 경우
            else:
                results.extend(get_items(item))

        return results

    # 2. dict가 아니면 처리하지 않음
    if not isinstance(payload, dict):
        return []

    # 3. jsonArray가 있는 경우
    if "jsonArray" in payload:
        return get_items(payload["jsonArray"])

    # 4. item이 있는 경우
    if "item" in payload:
        return get_items(payload["item"])

    # 5. 현재 dict 자체가 공고 하나인 경우
    if "pblancId" in payload or "pblancNm" in payload:
        return [payload]

    return []

def detect_districts(text: str) -> list[str]:
    return [district for district in SEOUL_DISTRICTS if district in text]

def keyword_hits(text: str, terms: Iterable[str]) -> list[str]:
    return [term for term in terms if term in text]

def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows

def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
