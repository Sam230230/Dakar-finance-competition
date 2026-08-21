"""
소상공인시장진흥공단 상가(상권)정보 API 클라이언트.

용도(우리 서비스):
  1) 후보 매장 반경(300/500m) 내 '동종업소 수' 조회  → 결과 지도의 경쟁 근거
  2) 주소가 서울시 상권 폴리곤 '밖'일 때의 폴백(좌표만으로 조회 가능)

- End Point: https://apis.data.go.kr/B553077/api/open/sdsc2
- 핵심 오퍼레이션: /storeListInRadius (반경내 상가업소 조회)
- 업종코드는 /largeUpjongList, /middleUpjongList, /smallUpjongList 로 조회.
- serviceKey 는 data.go.kr '일반 인증키(Encoding)'를 그대로 사용(이중 인코딩 금지).
- 외부 의존성 없이 표준 라이브러리(urllib)만 사용.

환경변수:
  SOSANGONG_SERVICE_KEY   data.go.kr 발급 인증키(Encoding 형태 권장)
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import List, Optional

BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2"


class SosangongError(Exception):
    pass


@dataclass
class Store:
    bizes_id: str          # 상가업소번호
    name: str              # 상호명
    inds_large: str        # 업종 대분류명
    inds_middle: str       # 업종 중분류명
    inds_small: str        # 업종 소분류명
    lat: Optional[float]   # 위도
    lng: Optional[float]   # 경도
    road_address: str = "" # 도로명주소


@dataclass
class RadiusResult:
    total_count: int       # 반경 내 (필터 적용된) 총 업소 수  ← 핵심 경쟁지표
    stores: List[Store]    # 상세 목록(지도 점 표시용)


def _service_key() -> str:
    key = os.getenv("SOSANGONG_SERVICE_KEY")
    if not key:
        raise SosangongError(
            "SOSANGONG_SERVICE_KEY 가 없습니다. .env 에 data.go.kr 인증키를 설정하세요."
        )
    return key


def _build_url(op: str, params: dict, service_key: str) -> str:
    """serviceKey 는 이미 URL 인코딩된 값이므로 별도로 인코딩하고 나머지만 urlencode."""
    query = urllib.parse.urlencode(params)  # serviceKey 제외 파라미터만 인코딩
    return f"{BASE}/{op}?serviceKey={service_key}&{query}"


def _get(op: str, params: dict, service_key: Optional[str], timeout: float) -> dict:
    key = service_key or _service_key()
    url = _build_url(op, params, key)
    req = urllib.request.Request(url, method="GET")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raise SosangongError(f"소진공 API HTTP 오류 {e.code}: {e.reason}") from e
    except Exception as e:  # noqa: BLE001
        raise SosangongError(f"소진공 API 요청 실패: {e}") from e
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        # 인증 실패 시 XML 에러가 오는 경우가 많음
        raise SosangongError(f"JSON 파싱 실패(키/트래픽 확인). 응답 앞부분: {raw[:200]}") from e


def _items(payload: dict) -> List[dict]:
    """body.items 가 list 이거나 {'item': [...]} 형태 둘 다 방어적으로 처리."""
    body = payload.get("body") or payload.get("response", {}).get("body") or {}
    items = body.get("items")
    if items is None:
        return []
    if isinstance(items, dict):
        items = items.get("item", [])
    if isinstance(items, dict):  # 단건이 dict 로 오는 경우
        items = [items]
    return items or []


def _total(payload: dict) -> int:
    body = payload.get("body") or payload.get("response", {}).get("body") or {}
    try:
        return int(body.get("totalCount", 0))
    except (TypeError, ValueError):
        return 0


def parse_store(d: dict) -> Store:
    def f(*keys):
        for k in keys:
            v = d.get(k)
            if v not in (None, ""):
                return v
        return ""
    lat = f("lat", "y")
    lng = f("lon", "lng", "x")
    return Store(
        bizes_id=str(f("bizesId", "bizes_id")),
        name=f("bizesNm", "bizes_nm"),
        inds_large=f("indsLclsNm"),
        inds_middle=f("indsMclsNm"),
        inds_small=f("indsSclsNm"),
        lat=float(lat) if lat else None,
        lng=float(lng) if lng else None,
        road_address=f("rdnmAdr", "rdnmAdrNm", "lnoAdr"),
    )


def stores_in_radius(
    lat: float, lng: float, radius_m: int = 300,
    inds_lcls_cd: Optional[str] = None,
    inds_mcls_cd: Optional[str] = None,
    inds_scls_cd: Optional[str] = None,
    num_rows: int = 100, page: int = 1,
    service_key: Optional[str] = None, timeout: float = 8.0,
) -> RadiusResult:
    """반경 내 상가업소 조회. 업종코드를 주면 동종업소만 필터링됨.
    cx=경도(lng), cy=위도(lat) 주의."""
    params = {
        "radius": radius_m,
        "cx": lng,          # 경도
        "cy": lat,          # 위도
        "type": "json",
        "numOfRows": num_rows,
        "pageNo": page,
    }
    if inds_lcls_cd:
        params["indsLclsCd"] = inds_lcls_cd
    if inds_mcls_cd:
        params["indsMclsCd"] = inds_mcls_cd
    if inds_scls_cd:
        params["indsSclsCd"] = inds_scls_cd

    payload = _get("storeListInRadius", params, service_key, timeout)
    stores = [parse_store(x) for x in _items(payload)]
    return RadiusResult(total_count=_total(payload), stores=stores)


def count_competitors(lat: float, lng: float, radius_m: int, inds_scls_cd: str,
                      service_key: Optional[str] = None) -> int:
    """반경 내 동종(소분류) 업소 수만 빠르게. 핵심 경쟁지표 카드용."""
    res = stores_in_radius(lat, lng, radius_m, inds_scls_cd=inds_scls_cd,
                           num_rows=1, service_key=service_key)
    return res.total_count


def small_upjong_list(keyword: Optional[str] = None,
                      service_key: Optional[str] = None, timeout: float = 8.0) -> List[dict]:
    """업종 소분류 코드 목록. '카페' 같은 키워드로 indsSclsCd 를 찾을 때 사용."""
    params = {"type": "json", "numOfRows": 1000, "pageNo": 1}
    payload = _get("smallUpjongList", params, service_key, timeout)
    items = _items(payload)
    if keyword:
        items = [i for i in items if keyword in (i.get("indsSclsNm", ""))]
    return items


if __name__ == "__main__":
    # 성수동 부근 좌표 예시로 반경 300m 조회 (키 설정 필요)
    try:
        res = stores_in_radius(37.5445, 127.0559, radius_m=300, num_rows=5)
        print(f"반경 300m 총 업소 수: {res.total_count}")
        for s in res.stores[:5]:
            print(f"  - {s.name} [{s.inds_small}] ({s.lat},{s.lng})")
    except SosangongError as e:
        print("[실패]", e)
