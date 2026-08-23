"""
좌표 → 서울시 상권코드(TRDAR_CD) 공간조인.

- 입력: 위/경도(WGS84) — NAVER 지오코딩 결과
- 데이터: 서울시 '영역-상권'(OA-15560) 폴리곤을 GeoJSON(WGS84)로 변환한 파일
    · SHP로 받은 경우 ogr2ogr / QGIS 로 EPSG:4326 GeoJSON 변환:
        ogr2ogr -f GeoJSON -t_srs EPSG:4326 sanggwon.geojson TBGIS_TRDAR_...shp
    · GeoJSON properties 에 상권코드/상권명 필드가 있어야 함(TRDAR_CD / TRDAR_CD_N 등).
- 동작: 점이 어느 상권 폴리곤 안에 있는지 판정(point-in-polygon).
        상권 밖이면 '가장 가까운 상권'으로 폴백(거리 함께 반환) → 리스크였던
        '주소가 상권 밖' 케이스를 메움.
- 의존성: shapely (권장). 없으면 순수 파이썬 폴백(폴리곤 판정은 제한적).

환경변수:
    SANGGWON_GEOJSON   영역-상권 GeoJSON 경로 (기본: data/sanggwon.geojson)
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from typing import List, Optional, Tuple

DEFAULT_PATH = os.getenv("SANGGWON_GEOJSON", "data/sanggwon.geojson")

# 상권코드/상권명으로 쓰일 수 있는 프로퍼티 키 후보(변환 도구마다 다름)
CODE_KEYS = ("TRDAR_CD", "trdar_cd", "TRDAR_CD_C", "STDR_TRDAR")
NAME_KEYS = ("TRDAR_CD_N", "TRDAR_NM", "trdar_cd_n", "TRDAR_CD_NM")

try:
    from shapely.geometry import shape, Point
    from shapely.strtree import STRtree
    _HAS_SHAPELY = True
except Exception:  # pragma: no cover
    _HAS_SHAPELY = False


@dataclass
class TrdarMatch:
    matched: bool           # 폴리곤 '안'에 들어갔는지
    trdar_cd: Optional[str]
    trdar_nm: Optional[str]
    distance_m: float = 0.0 # 폴백일 때 최근접 상권까지 거리(m). 안에 있으면 0.
    note: str = ""


def _prop(props: dict, keys) -> Optional[str]:
    for k in keys:
        if k in props and props[k] not in (None, ""):
            return str(props[k])
    return None


def _haversine_m(lat1, lng1, lat2, lng2) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


class SanggwonIndex:
    """영역-상권 폴리곤을 한 번 로드해 공간 인덱스로 조회."""

    def __init__(self, geojson_path: str = DEFAULT_PATH):
        self.path = geojson_path
        self._geoms = []          # shapely geometry
        self._meta = []           # (code, name)
        self._centroids = []      # (lat, lng) — 폴백/비-shapely용
        self._tree = None
        self._feature_by_code = {}
        self._loaded = False

    def load(self) -> "SanggwonIndex":
        if self._loaded:
            return self
        if not os.path.exists(self.path):
            raise FileNotFoundError(
                f"영역-상권 GeoJSON 이 없습니다: {self.path}\n"
                f"서울시 영역-상권(OA-15560) SHP를 EPSG:4326 GeoJSON 으로 변환해 두세요."
            )
        with open(self.path, encoding="utf-8") as f:
            gj = json.load(f)
        for feat in gj.get("features", []):
            props = feat.get("properties", {}) or {}
            code = _prop(props, CODE_KEYS)
            name = _prop(props, NAME_KEYS)
            geom = feat.get("geometry")
            if code and geom:
                self._feature_by_code[str(code)] = geom
            if not geom:
                continue
            if _HAS_SHAPELY:
                g = shape(geom)
                self._geoms.append(g)
                c = g.centroid
                self._centroids.append((c.y, c.x))
            else:
                # 폴백: 중심점만 근사(첫 좌표들 평균)
                self._centroids.append(_rough_centroid(geom))
            self._meta.append((code, name))
        if _HAS_SHAPELY and self._geoms:
            self._tree = STRtree(self._geoms)
        self._loaded = True
        return self


    def geometry_for(self, trdar_cd: str):
        self.load()
        return self._feature_by_code.get(str(trdar_cd))

    def lookup(self, lat: float, lng: float) -> TrdarMatch:
        self.load()
        if _HAS_SHAPELY and self._tree is not None:
            pt = Point(lng, lat)  # (x=lng, y=lat)
            # STRtree 후보 중 실제 포함 폴리곤 확인
            for idx in self._tree.query(pt):
                i = int(idx)
                if self._geoms[i].contains(pt):
                    code, name = self._meta[i]
                    return TrdarMatch(True, code, name, 0.0, "상권 내부")
        # 폴백: 최근접 중심점
        best_i, best_d = -1, float("inf")
        for i, (clat, clng) in enumerate(self._centroids):
            d = _haversine_m(lat, lng, clat, clng)
            if d < best_d:
                best_d, best_i = d, i
        if best_i < 0:
            return TrdarMatch(False, None, None, 0.0, "상권 데이터 없음")
        code, name = self._meta[best_i]
        return TrdarMatch(False, code, name, round(best_d, 1),
                          "상권 밖 — 최근접 상권으로 폴백")


def _rough_centroid(geom: dict) -> Tuple[float, float]:
    """shapely 없을 때 좌표 평균으로 대략 중심(위,경도) 계산."""
    coords = []
    def walk(x):
        if isinstance(x, (list, tuple)):
            if x and isinstance(x[0], (int, float)):
                coords.append(x)  # [lng, lat]
            else:
                for y in x:
                    walk(y)
    walk(geom.get("coordinates", []))
    if not coords:
        return (0.0, 0.0)
    lng = sum(c[0] for c in coords) / len(coords)
    lat = sum(c[1] for c in coords) / len(coords)
    return (lat, lng)


# 모듈 전역 싱글턴(서버에서 1회 로드)
_index: Optional[SanggwonIndex] = None


def lookup_trdar(lat: float, lng: float, path: str = DEFAULT_PATH) -> TrdarMatch:
    global _index
    if _index is None or _index.path != path:
        _index = SanggwonIndex(path)
    return _index.lookup(lat, lng)


def get_trdar_geometry(trdar_cd: str, path: str = DEFAULT_PATH):
    global _index
    if _index is None or _index.path != path:
        _index = SanggwonIndex(path)
    return _index.geometry_for(trdar_cd)


if __name__ == "__main__":
    import sys
    lat = float(sys.argv[1]) if len(sys.argv) > 2 else 37.5561
    lng = float(sys.argv[2]) if len(sys.argv) > 2 else 126.9106
    try:
        m = lookup_trdar(lat, lng)
        print(m)
    except FileNotFoundError as e:
        print("[안내]", e)
