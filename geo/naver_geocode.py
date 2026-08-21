"""
네이버 클라우드 플랫폼(NCP) Geocoding — 주소 → 좌표 변환.

- 엔드포인트: https://maps.apigw.ntruss.com/map-geocode/v2/geocode
- 헤더: x-ncp-apigw-api-key-id / x-ncp-apigw-api-key  (NCP Maps 발급값)
- 파이프라인의 '권위 있는' 좌표 산출 지점. 프론트 지도는 이 좌표를 받아 표시만 한다.
- 외부 의존성 없이 표준 라이브러리(urllib)만 사용 → 단독 테스트 가능.

환경변수:
    NCP_APIGW_KEY_ID   NCP Maps API Key ID
    NCP_APIGW_KEY      NCP Maps API Key
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Optional

GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"


class GeocodeError(Exception):
    """지오코딩 실패(키 없음/네트워크/미매칭)."""


@dataclass
class GeoPoint:
    lat: float            # 위도 (y)
    lng: float            # 경도 (x)
    road_address: str     # 도로명 주소
    jibun_address: str    # 지번 주소
    matched: bool = True  # 주소가 실제로 매칭됐는지


def _build_request(address: str, key_id: str, key: str) -> urllib.request.Request:
    qs = urllib.parse.urlencode({"query": address})
    req = urllib.request.Request(f"{GEOCODE_URL}?{qs}", method="GET")
    req.add_header("x-ncp-apigw-api-key-id", key_id)
    req.add_header("x-ncp-apigw-api-key", key)
    req.add_header("Accept", "application/json")
    return req


def parse_response(payload: dict) -> Optional[GeoPoint]:
    """NCP 응답(dict) → GeoPoint. 매칭 없으면 None."""
    addresses = payload.get("addresses") or []
    if not addresses:
        return None
    a = addresses[0]
    return GeoPoint(
        lat=float(a["y"]),
        lng=float(a["x"]),
        road_address=a.get("roadAddress", ""),
        jibun_address=a.get("jibunAddress", ""),
        matched=True,
    )


def geocode(address: str, key_id: Optional[str] = None, key: Optional[str] = None,
            timeout: float = 5.0) -> GeoPoint:
    """주소를 좌표로 변환. 실패 시 GeocodeError."""
    key_id = key_id or os.getenv("NCP_APIGW_KEY_ID")
    key = key or os.getenv("NCP_APIGW_KEY")
    if not key_id or not key:
        raise GeocodeError(
            "NCP Maps 키가 없습니다. .env 에 NCP_APIGW_KEY_ID / NCP_APIGW_KEY 를 설정하세요."
        )
    if not address or not address.strip():
        raise GeocodeError("빈 주소입니다.")

    req = _build_request(address, key_id, key)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:  # 401/429 등
        raise GeocodeError(f"NCP 지오코딩 HTTP 오류 {e.code}: {e.reason}") from e
    except Exception as e:  # noqa: BLE001
        raise GeocodeError(f"NCP 지오코딩 요청 실패: {e}") from e

    point = parse_response(payload)
    if point is None:
        raise GeocodeError(f"주소를 찾지 못했습니다: {address!r}")
    return point


if __name__ == "__main__":
    import sys
    addr = sys.argv[1] if len(sys.argv) > 1 else "서울 성동구 성수이로 22"
    try:
        p = geocode(addr)
        print(f"{addr}\n → 위도 {p.lat}, 경도 {p.lng}\n   도로명: {p.road_address}")
    except GeocodeError as e:
        print("[실패]", e)
