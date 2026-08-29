"""
실데이터 로더 — 서울시 상권분석서비스(추정매출-자치구) JSON → v1/v2/v3 학습 테이블.

grain: 자치구 × 업종 × 분기 (signgu × svc_induty × stdr_yyqu)
소스:  data/real_data/서울시 상권분석서비스(추정매출-자치구).json  (자치구 단위 추정매출, 21분기)

피처는 '누출 없는' 시계열 예측 형태만 쓴다:
    prev_sales  직전 분기 동일(자치구·업종) 매출
    yoy_sales   전년 동기(4분기 전) 매출
    season      분기 계절성 (1~4)
타깃:
    monthly_sales  당월 추정매출(만원)  [회귀]
    survived_2y    8분기 뒤 매출이 현재의 50% 이상 유지되면 1  [분류·프록시]

# ponytail: 상권단위 유동/직장/상주인구 CSV(real_data/)는 자치구 crosswalk가 없어
#   이 자치구 grain에 조인 불가 → 미사용. 상권코드↔자치구 매핑이 생기면 피처로 추가.
# ponytail: survived_2y 는 실제 폐업이 아니라 '매출 반토막' 프록시. 진짜 폐업 라벨
#   (VwsmTrdarIxQq 의 OPR_SALE_MT_AVRG 등)이 확보되면 교체.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

SALES_JSON = (Path(__file__).parent / "real_data"
              / "서울시 상권분석서비스(추정매출-자치구).json")

SURVIVE_HORIZON = 8   # 분기 (2년)
SURVIVE_RATIO = 0.5   # 이 비율 이상 유지 시 '생존'


def build_real() -> pd.DataFrame:
    rows = json.loads(SALES_JSON.read_text())["DATA"]
    df = pd.DataFrame(rows)[["signgu_cd_nm", "svc_induty_cd_nm",
                             "stdr_yyqu_cd", "thsmon_selng_amt"]]
    df.columns = ["signgu", "svc_induty", "stdr_yyqu", "monthly_sales"]
    df["stdr_yyqu"] = df["stdr_yyqu"].astype(int)
    df["monthly_sales"] = pd.to_numeric(df["monthly_sales"], errors="coerce") / 10000.0  # 원→만원
    df = (df.dropna(subset=["monthly_sales"])
            .groupby(["signgu", "svc_induty", "stdr_yyqu"], as_index=False)["monthly_sales"].sum()
            .sort_values(["signgu", "svc_induty", "stdr_yyqu"]))

    g = df.groupby(["signgu", "svc_induty"])["monthly_sales"]
    df["prev_sales"] = g.shift(1)
    df["yoy_sales"] = g.shift(4)
    df["future_sales"] = g.shift(-SURVIVE_HORIZON)
    df["season"] = df["stdr_yyqu"] % 10
    df["survived_2y"] = (df["future_sales"] >= SURVIVE_RATIO * df["monthly_sales"]).astype("Int64")
    df.loc[df["future_sales"].isna(), "survived_2y"] = pd.NA

    # 랙 피처가 있는 행만 (첫 4분기 제거) — 모델들이 NaN 피처를 안 받음
    return df.dropna(subset=["prev_sales", "yoy_sales"]).drop(columns=["future_sales"])


def _check():
    d = build_real()
    assert not d[["prev_sales", "yoy_sales"]].isna().any().any(), "랙 피처에 NaN"
    assert {"signgu", "svc_induty", "monthly_sales", "survived_2y", "season"} <= set(d.columns)
    assert d["season"].between(1, 4).all(), "season 은 1~4"
    assert d["survived_2y"].dropna().isin([0, 1]).all()
    # 랙: 그룹 내 prev_sales(t) == monthly_sales(t-1)
    chk = d.sort_values("stdr_yyqu").copy()
    chk["expect"] = chk.groupby(["signgu", "svc_induty"])["monthly_sales"].shift(1)
    both = chk.dropna(subset=["expect"])
    assert np.allclose(both["prev_sales"], both["expect"]), "prev_sales 랙 불일치"
    print("ok", d.shape)


if __name__ == "__main__":
    _check()
    d = build_real()
    print(f"shape={d.shape}  자치구 {d.signgu.nunique()}  업종 {d.svc_induty.nunique()}  "
          f"분기 {d.stdr_yyqu.nunique()}")
    print(f"매출 평균 {d.monthly_sales.mean():,.0f}만  "
          f"생존율 {d.survived_2y.dropna().mean():.1%} (n={d.survived_2y.notna().sum()})")
    print(d.head())
