"""
지역별 매출 유지율 추이 분석.
- '유지율 추이' = 각 자치구(또는 상권)의 분기별 동종매출이 전년 동기 대비 얼마나 유지/성장하는가.
- 방법: 자치구×업종×분기 매출 집계 → 전년동기比(YoY) → 분기 인덱스에 대한 선형 추세기울기.
  기울기>0 = 매출이 우상향(유지·성장 상권), <0 = 쇠퇴 경고.
- 출력: 자치구별 추세표(CSV) + 요약.
실행: python retention_trend.py
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from features import ARTIFACT_DIR, load_data


def yoy_retention(df: pd.DataFrame) -> pd.DataFrame:
    """자치구×업종×분기 매출 합계 → 전년동기(=4분기 전) 대비 유지율."""
    g = (df.groupby(["signgu", "svc_induty", "stdr_yyqu"])["monthly_sales"]
         .mean().reset_index().sort_values("stdr_yyqu"))
    g["prev_year"] = g.groupby(["signgu", "svc_induty"])["monthly_sales"].shift(4)
    g["retention"] = g["monthly_sales"] / g["prev_year"]
    return g.dropna(subset=["retention"])


def region_trend(df: pd.DataFrame) -> pd.DataFrame:
    """자치구별 분기 매출 추세 기울기(정규화) → 상승/보합/하락 라벨."""
    rows = []
    for gu, sub in df.groupby("signgu"):
        q = sub.groupby("stdr_yyqu")["monthly_sales"].mean().sort_index()
        x = np.arange(len(q))
        # 기울기 / 평균 → 분기당 % 성장
        slope = np.polyfit(x, q.values, 1)[0]
        pct = slope / q.mean() * 100
        label = "상승" if pct > 0.6 else ("하락" if pct < -0.6 else "보합")
        rows.append({"signgu": gu, "avg_sales": round(q.mean()),
                     "quarterly_growth_pct": round(pct, 2), "trend": label})
    return pd.DataFrame(rows).sort_values("quarterly_growth_pct", ascending=False)


def main():
    df = load_data()
    ret = yoy_retention(df)
    trend = region_trend(df)

    out1 = ARTIFACT_DIR / "retention_yoy.csv"
    out2 = ARTIFACT_DIR / "region_trend.csv"
    ret.to_csv(out1, index=False, encoding="utf-8")
    trend.to_csv(out2, index=False, encoding="utf-8")

    print("=" * 56)
    print("지역별 매출 유지율 추이")
    print("=" * 56)
    print(f"전년동기比 유지율 평균: {ret['retention'].mean():.1%}")
    print("\n[자치구별 분기 매출 추세]")
    print(trend.to_string(index=False))
    print(f"\n저장: {out1.name}, {out2.name}")
    return trend


if __name__ == "__main__":
    main()
