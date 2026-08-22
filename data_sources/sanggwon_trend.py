"""
서울시 우리마을가게 상권분석서비스 — "상권변화지표-상권" 연동.

목적(젠트리피케이션 관련 근거를 '예측'이 아니라 '정형 분류'로 제공):
  이 서비스는 매출/생존율 등을 스크래핑하거나 LLM으로 추정하지 않는다.
  대신 서울시가 이미 만들어 둔 "상권변화지표"(개업률·폐업률/영업기간 등을
  기준으로 상권을 4개 등급으로 나눈 정형 데이터)를 그대로 인용한다.

  등급 체계(서울시 정의, 생존율×폐업율 2x2):
    HH : 생존율 높음 + 폐업율 높음 → "다이나믹"  (활발히 change 중, 진입도 퇴장도 많음)
    HL : 생존율 높음 + 폐업율 낮음 → "안정"       (기존 점포에 유리)
    LH : 생존율 낮음 + 폐업율 높음 → "정체/축소"   (신규 진입에 주의 필요)
    LL : 생존율 낮음 + 폐업율 낮음 → "주의 요망"   (신규 진입에 주의 필요)
  (정확한 등급 코드/라벨은 서울 열린데이터광장 OA-15576 명세를 따른다.
   이 모듈은 원본 필드를 그대로 통과시키고, 우리 쪽에서는 '설명 라벨'만 덧붙인다 —
   새로운 위험도 점수나 예측치를 만들어내지 않는다.)

전제 조건:
  - 후보지 좌표 → geo/sanggwon_join.lookup_trdar() 로 TRDAR_CD(상권코드) 확보가 먼저 필요.
  - 이 API의 실제 오퍼레이션명/파라미터명은 서울 열린데이터광장 스펙 문서에서
    최종 확인 후 OPERATION 값을 맞춰야 한다(계정마다 배포판 오퍼레이션명이 다를 수 있음).
    아래 기본값은 우리마을가게 상권분석서비스의 명명 규칙(Vwsm + Trdar + 지표약어 + Qq)을 따른 추정값이다.

환경변수:
  SEOUL_OPENAPI_KEY   data.seoul.go.kr 발급 인증키
  SANGGWON_TREND_OPERATION  오퍼레이션명 override (기본: VwsmTrdarChagInxQq)
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Optional

BASE = "http://openapi.seoul.go.kr:8088"
DEFAULT_OPERATION = os.getenv("SANGGWON_TREND_OPERATION", "VwsmTrdarChagInxQq")

# 서울시 정의: 생존율(survival)×폐업율(closure) 2x2 등급 → 우리 쪽 설명 라벨.
# 라벨은 '가능성이 있다/없다'는 판단이 아니라 서울시가 분류한 상태를 그대로 옮긴 것.
GRADE_LABELS = {
    "HH": "다이나믹 (진입·퇴장 모두 활발)",
    "HL": "안정 (생존율 높음, 폐업 적음)",
    "LH": "정체·축소 (생존율 낮음, 폐업 많음)",
    "LL": "주의 요망 (생존율 낮음, 폐업 적어도 정체)",
}


class SanggwonTrendError(Exception):
    pass


@dataclass
class TrdarTrend:
    trdar_cd: str
    trdar_nm: str
    std_yy: str                 # 기준연도
    change_grade: Optional[str] # 원본 등급 코드(HH/HL/LH/LL 등) — 서울시 원본값 그대로
    grade_label: str            # 위 GRADE_LABELS 매핑(모르는 코드면 원본 코드 그대로 노출)
    raw: dict                   # 원본 응답 레코드(감사·검증용, 그대로 보존)


def _api_key() -> str:
    key = os.getenv("SEOUL_OPENAPI_KEY")
    if not key:
        raise SanggwonTrendError(
            "SEOUL_OPENAPI_KEY 가 없습니다. .env 에 서울 열린데이터광장 인증키를 설정하세요."
        )
    return key


def _fetch(trdar_cd: str, operation: str, service_key: Optional[str], timeout: float) -> dict:
    key = service_key or _api_key()
    # 서울시 OpenAPI 공통 URL 패턴: /{key}/json/{operation}/{start}/{end}/{조건...}
    url = f"{BASE}/{key}/json/{operation}/1/5/{urllib.parse.quote(trdar_cd)}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raise SanggwonTrendError(f"상권변화지표 API HTTP 오류 {e.code}: {e.reason}") from e
    except Exception as e:  # noqa: BLE001
        raise SanggwonTrendError(f"상권변화지표 API 요청 실패: {e}") from e
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise SanggwonTrendError(f"JSON 파싱 실패(키/오퍼레이션명 확인). 응답 앞부분: {raw[:200]}") from e


def _rows(payload: dict, operation: str) -> list:
    body = payload.get(operation) or {}
    result = body.get("RESULT") or {}
    code = result.get("CODE", "")
    if code and not str(code).startswith("INFO-0"):
        raise SanggwonTrendError(f"상권변화지표 API 오류: {result.get('MESSAGE', code)}")
    return body.get("row") or []


def get_trend(trdar_cd: str, operation: str = None,
              service_key: Optional[str] = None, timeout: float = 8.0) -> Optional[TrdarTrend]:
    """상권코드로 최신 상권변화지표 1건 조회. 데이터 없으면 None(추정하지 않음)."""
    op = operation or DEFAULT_OPERATION
    payload = _fetch(trdar_cd, op, service_key, timeout)
    rows = _rows(payload, op)
    if not rows:
        return None
    row = rows[0]  # 최신연도 1건(정렬은 API 기본순 — 필요 시 STDR_YY 기준 정렬 보강)

    def f(*keys):
        for k in keys:
            v = row.get(k)
            if v not in (None, ""):
                return v
        return ""

    grade = f("TRDAR_CHNGE_IND", "TRDAR_CHANG_INDX", "CHNGE_IND") or None
    grade_str = str(grade).upper() if grade else None
    label = GRADE_LABELS.get(grade_str, grade_str or "등급 정보 없음")

    return TrdarTrend(
        trdar_cd=str(f("TRDAR_CD")),
        trdar_nm=str(f("TRDAR_CD_NM", "TRDAR_NM")),
        std_yy=str(f("STDR_YY_CD", "STDR_YY")),
        change_grade=grade_str,
        grade_label=label,
        raw=row,
    )


def trend_for_coords(lat: float, lng: float, sanggwon_geojson_path: Optional[str] = None,
                     service_key: Optional[str] = None):
    """좌표 → (상권조인 → 상권변화지표) 한 번에. 상권 밖이면 폴백 상권 기준으로 조회하되
    '폴백'이었음을 그대로 알려준다(추정 없이 사실만 전달)."""
    from geo.sanggwon_join import lookup_trdar, DEFAULT_PATH

    match = lookup_trdar(lat, lng, sanggwon_geojson_path or DEFAULT_PATH)
    if not match.trdar_cd:
        return None, match
    trend = get_trend(match.trdar_cd, service_key=service_key)
    return trend, match


if __name__ == "__main__":
    import sys
    trdar_cd = sys.argv[1] if len(sys.argv) > 1 else "3110859"  # 예시 코드 — 실제 코드로 교체 필요
    try:
        t = get_trend(trdar_cd)
        if t is None:
            print("[안내] 해당 상권코드의 변화지표 데이터가 없습니다.")
        else:
            print(f"{t.trdar_nm} ({t.trdar_cd}, 기준 {t.std_yy}년): {t.grade_label} (원본코드: {t.change_grade})")
    except SanggwonTrendError as e:
        print("[실패]", e)
