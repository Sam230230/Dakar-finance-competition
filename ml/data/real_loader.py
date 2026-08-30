"""
실데이터 로더 — 서울시 상권분석서비스(추정매출-자치구) JSON + 실제 유동/직장/상주인구
CSV(TRDAR_CD→자치구 합산)를 결합해 v1/v2 재학습용 테이블을 만든다.

grain: 자치구 × 분기 (signgu × stdr_yyqu). 업종은 커피-음료(CS100010)로 고정한다 —
서비스가 카페 기준 MVP이기 때문(2026-08 재학습 지침).

피처는 '누출 없는' 시계열 예측 형태만 쓴다:
    prev_sales     직전 분기 동일 자치구 매출
    yoy_sales      전년 동기(4분기 전) 매출
    season         분기 계절성 (1~4)
    flow_pop       그 분기 자치구 내 전체 상권(TRDAR_CD) 유동인구 합계
    work_pop       〃 직장인구 합계
    resident_pop   〃 상주인구 합계
타깃:
    monthly_sales  자치구 전체 커피-음료 당월 추정매출(만원) [회귀]

인구 피처는 TRDAR_CD 단위 실측 CSV를 sanggwon.geojson의 TRDAR_CD→SIGNGU_CD_ 매핑으로
자치구 단위 합산한 것이다(ml/runtime.py::_geo_district_map()과 동일한 크로스워크 소스).
이전 버전의 '자치구 crosswalk가 없어 미사용' 주석은 이 매핑을 추가하면서 해소됐다.

v3_closure_clf(합성 폐업 라벨) 폐기 방침에 따라 survived_2y/future_sales는 더 이상
만들지 않는다 — 안정성 지표는 data_sources.seoul_market의 실측 폐업률/개업률을 쓴다.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

REAL_DATA_DIR = Path(__file__).parent / "real_data"
GEOJSON_PATH = Path(__file__).resolve().parents[2] / "data" / "sanggwon.geojson"

INDUSTRY_NAME = "커피-음료"  # CS100010, 확인됨: svc_induty_cd_nm 1:1 매칭


def _find_json(min_bytes: int) -> Path:
    """real_data/의 JSON 파일명이 인코딩이 깨져 디스크에 저장돼 있어(#U... 리터럴),
    하드코딩된 한글 파일명으로는 절대 못 찾는다 — 크기로 식별한다."""
    candidates = [p for p in REAL_DATA_DIR.glob("*.json") if p.stat().st_size >= min_bytes]
    if not candidates:
        raise FileNotFoundError(f"{REAL_DATA_DIR}에 {min_bytes} bytes 이상 JSON 없음")
    return max(candidates, key=lambda p: p.stat().st_size)


def _load_sales_by_district() -> pd.DataFrame:
    """자치구×커피-음료×분기 실제 추정매출 (21분기 시계열)."""
    path = _find_json(min_bytes=10_000_000)  # 추정매출 파일 ~46MB, 집객시설 파일 ~3.7MB 구분
    rows = json.loads(path.read_text(encoding="utf-8"))["DATA"]
    df = pd.DataFrame(rows)
    df = df[df["svc_induty_cd_nm"] == INDUSTRY_NAME][
        ["signgu_cd_nm", "stdr_yyqu_cd", "thsmon_selng_amt"]
    ].copy()
    df.columns = ["signgu", "stdr_yyqu", "monthly_sales"]
    df["stdr_yyqu"] = df["stdr_yyqu"].astype(int)
    df["monthly_sales"] = pd.to_numeric(df["monthly_sales"], errors="coerce") / 10000.0  # 원→만원
    return (df.dropna(subset=["monthly_sales"])
              .groupby(["signgu", "stdr_yyqu"], as_index=False)["monthly_sales"].sum()
              .sort_values(["signgu", "stdr_yyqu"]))


def _trdar_to_district() -> dict[str, str]:
    """TRDAR_CD → 자치구, sanggwon.geojson 기반 (ml/runtime.py::_geo_district_map()과 동일 소스)."""
    if not GEOJSON_PATH.exists():
        return {}
    raw = json.loads(GEOJSON_PATH.read_text(encoding="utf-8"))
    out = {}
    for feature in raw.get("features", []):
        props = feature.get("properties") or {}
        code = str(props.get("TRDAR_CD") or "")
        district = props.get("SIGNGU_CD_")
        if code and district:
            out[code] = str(district)
    return out


def _population_by_district(filename: str, value_col: str, out_col: str) -> pd.DataFrame:
    """TRDAR_CD×분기 실측 인구 CSV → 자치구×분기 합산 (crosswalk: sanggwon.geojson)."""
    path = REAL_DATA_DIR / filename
    df = pd.read_csv(path, usecols=["STDR_YYQU_CD", "TRDAR_CD", value_col])
    trdar_to_gu = _trdar_to_district()
    df["signgu"] = df["TRDAR_CD"].astype(str).map(trdar_to_gu)
    df = df.dropna(subset=["signgu"])
    df["stdr_yyqu"] = pd.to_numeric(df["STDR_YYQU_CD"], errors="coerce")
    df[value_col] = pd.to_numeric(df[value_col], errors="coerce")
    agg = (df.dropna(subset=["stdr_yyqu", value_col])
             .groupby(["signgu", "stdr_yyqu"], as_index=False)[value_col].sum()
             .rename(columns={value_col: out_col}))
    agg["stdr_yyqu"] = agg["stdr_yyqu"].astype(int)
    return agg


def build_real() -> pd.DataFrame:
    df = _load_sales_by_district()

    pop_specs = [
        ("VwsmTrdarFlpopQq.csv", "TOT_FLPOP_CO", "flow_pop"),
        ("VwsmTrdarWrcPopltnQq.csv", "TOT_WRC_POPLTN_CO", "work_pop"),
        ("VwsmTrdarRepopQq.csv", "TOT_REPOP_CO", "resident_pop"),
    ]
    for filename, value_col, out_col in pop_specs:
        pop = _population_by_district(filename, value_col, out_col)
        df = df.merge(pop, on=["signgu", "stdr_yyqu"], how="left")

    g = df.groupby("signgu")["monthly_sales"]
    df["prev_sales"] = g.shift(1)
    df["yoy_sales"] = g.shift(4)
    df["season"] = df["stdr_yyqu"] % 10

    # 랙 피처가 있는 행만(첫 4분기 자치구별 제거) — 모델이 NaN 피처를 못 받음.
    return df.dropna(subset=["prev_sales", "yoy_sales"]).reset_index(drop=True)


def _check():
    d = build_real()
    assert not d[["prev_sales", "yoy_sales"]].isna().any().any(), "랙 피처에 NaN"
    assert {"signgu", "monthly_sales", "season", "flow_pop", "work_pop", "resident_pop"} <= set(d.columns)
    assert d["season"].between(1, 4).all(), "season 은 1~4"
    chk = d.sort_values(["signgu", "stdr_yyqu"]).copy()
    chk["expect"] = chk.groupby("signgu")["monthly_sales"].shift(1)
    both = chk.dropna(subset=["expect"])
    assert np.allclose(both["prev_sales"], both["expect"]), "prev_sales 랙 불일치"
    print("ok", d.shape)


if __name__ == "__main__":
    _check()
    d = build_real()
    print(f"shape={d.shape}  자치구 {d.signgu.nunique()}  분기 {d.stdr_yyqu.nunique()} "
          f"({d.stdr_yyqu.min()}~{d.stdr_yyqu.max()})")
    print(f"매출 평균 {d.monthly_sales.mean():,.0f}만원")
    print(f"인구 피처 결측: flow_pop={d.flow_pop.isna().sum()} work_pop={d.work_pop.isna().sum()} "
          f"resident_pop={d.resident_pop.isna().sum()}")
    print(d.head())
