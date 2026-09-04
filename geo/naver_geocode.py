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
    """지오코딩 실패.

    원인을 kind 로 나눈다 — 사용자가 할 일이 완전히 다르기 때문이다.
      "config"   서버에 키가 없다. 주소를 아무리 고쳐도 소용없다.
      "upstream" NCP 응답 오류나 네트워크 실패. 마찬가지로 사용자 잘못이 아니다.
      "address"  주소를 실제로 못 찾았다. 이때만 사용자가 고칠 수 있다.
    이걸 뭉개면 ".env 가 없는 팀원"에게 "주소를 다시 확인하세요"라고 말하게 된다.
    """

    def __init__(self, message: str, kind: str = "address"):
        super().__init__(message)
        self.kind = kind


#: 주소가 어느 단위까지 해석됐는지. 앞쪽일수록 넓다.
#: 상권(TRDAR)은 한 변이 수백 m라, 구·동 단위 주소로는 어느 상권인지 정해지지 않는다.
#: 예) "서울 송파구" → 구 중심점이 우연히 걸린 상권이 잡힌다.
PRECISION_ORDER = ("none", "city", "district", "dong", "land", "road")

#: 상권을 특정할 수 있다고 보는 최소 단위
PRECISION_MIN_FOR_TRDAR = "land"


def classify_precision(address_elements: list) -> str:
    """NCP addressElements 로 주소 해석 단위를 판정한다.

    문자열을 쪼개는 대신 NCP가 붙여 준 타입을 쓴다. "서울 송파구 올림픽로 300" 처럼
    입력에 동이 없어도 NCP가 DONGMYUN 을 채워 주므로, 입력 토큰 수로는 판정할 수 없다.
    """
    types = set()
    for element in address_elements or []:
        if not element.get("longName"):
            continue  # 타입만 있고 값이 빈 항목이 섞여 온다
        types.update(element.get("types") or [])
    if "BUILDING_NUMBER" in types:
        return "road"
    if "LAND_NUMBER" in types:
        return "land"
    if "DONGMYUN" in types:
        return "dong"
    if "SIGUGUN" in types:
        return "district"
    if "SIDO" in types:
        return "city"
    return "none"


def precision_at_least(precision: str, minimum: str = PRECISION_MIN_FOR_TRDAR) -> bool:
    """precision 이 minimum 이상으로 좁은지."""
    try:
        return PRECISION_ORDER.index(precision) >= PRECISION_ORDER.index(minimum)
    except ValueError:
        return False


@dataclass
class GeoPoint:
    lat: float            # 위도 (y)
    lng: float            # 경도 (x)
    road_address: str     # 도로명 주소
    jibun_address: str    # 지번 주소
    matched: bool = True  # 주소가 실제로 매칭됐는지
    precision: str = "none"  # classify_precision 결과


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
        precision=classify_precision(a.get("addressElements")),
    )


def geocode(address: str, key_id: Optional[str] = None, key: Optional[str] = None,
            timeout: float = 5.0) -> GeoPoint:
    """주소를 좌표로 변환. 실패 시 GeocodeError."""
    key_id = key_id or os.getenv("NCP_APIGW_KEY_ID")
    key = key or os.getenv("NCP_APIGW_KEY")
    if not key_id or not key:
        raise GeocodeError(
            "NCP Maps 키가 없습니다. .env 에 NCP_APIGW_KEY_ID / NCP_APIGW_KEY 를 설정하세요.",
            kind="config",
        )
    if not address or not address.strip():
        raise GeocodeError("빈 주소입니다.", kind="address")

    req = _build_request(address, key_id, key)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:  # 401/429 등
        raise GeocodeError(f"NCP 지오코딩 HTTP 오류 {e.code}: {e.reason}", kind="upstream") from e
    except Exception as e:  # noqa: BLE001
        raise GeocodeError(f"NCP 지오코딩 요청 실패: {e}", kind="upstream") from e

    point = parse_response(payload)
    if point is None:
        raise GeocodeError(f"주소를 찾지 못했습니다: {address!r}", kind="address")
    return point


if __name__ == "__main__":
    import sys
    addr = sys.argv[1] if len(sys.argv) > 1 else "서울 성동구 성수이로 22"
    try:
        p = geocode(addr)
        print(f"{addr}\n → 위도 {p.lat}, 경도 {p.lng}\n   도로명: {p.road_address}")
    except GeocodeError as e:
        print("[실패]", e)
