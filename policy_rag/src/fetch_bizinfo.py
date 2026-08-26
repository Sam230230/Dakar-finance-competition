from __future__ import annotations

import json
import os
from pathlib import Path

import requests

from common import RAW_BIZINFO_DIR, env_required

API_URL = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do"

# 실제 API 호출 세트
# 1) 전국 금융: 전국 공통 정책자금 후보 확보
# 2) 서울 금융: 서울 지역 금융지원 후보 확보
# 3) 서울 경영: 직접지원/경영지원 중 서울 소재 후보 보완
QUERIES = [
    {"name": "finance_all", "searchLclasId": "01", "hashtags": None},
    {"name": "finance_seoul", "searchLclasId": "01", "hashtags": "서울"},
    {"name": "management_seoul", "searchLclasId": "07", "hashtags": "서울"},
]

def fetch_one(api_key: str, query: dict, search_count: int) -> Path:
    params = {
        "crtfcKey": api_key,
        "dataType": "json",
        "searchCnt": str(search_count),
        "searchLclasId": query["searchLclasId"],
    }
    if query.get("hashtags"):
        params["hashtags"] = query["hashtags"]

    response = requests.get(
        API_URL,
        params=params,
        timeout=60,
        headers={"User-Agent": "StayOrMove-RAG-MVP/1.0"},
    )
    response.raise_for_status()

    try:
        data = response.json()
    except Exception as exc:
        preview = response.text[:500]
        raise RuntimeError(
            f"기업마당 응답을 JSON으로 읽지 못했습니다.\n응답 앞부분:\n{preview}"
        ) from exc

    output = RAW_BIZINFO_DIR / f"{query['name']}.json"
    with output.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"[수집 완료] {query['name']}: {output}")
    return output

def fetch_all() -> list[Path]:
    api_key = env_required("BIZINFO_API_KEY")
    search_count = int(os.getenv("BIZINFO_SEARCH_COUNT", "100"))
    outputs = []
    for query in QUERIES:
        outputs.append(fetch_one(api_key, query, search_count))
    return outputs

if __name__ == "__main__":
    fetch_all()
