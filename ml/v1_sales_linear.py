"""
ML v1 — 후보 입지 월매출 예측 (선형회귀 '투명 베이스라인').
- 목적: 감으로 넣던 '매출 유지율'을 데이터 기반 예측으로 대체하기 위한 1차 모델.
- 왜 선형회귀부터: 계수로 '무엇이 매출을 올리고 내리는지' 바로 설명 가능(감사 용이).
- 출력: R²/MAE/RMSE + 학습된 파이프라인 저장(joblib).
실행: python v1_sales_linear.py
"""
from __future__ import annotations

import joblib
import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score, root_mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from features import (ARTIFACT_DIR, TARGET_SALES, feature_cols, load_data, split_xy)


def build(num, cat) -> Pipeline:
    pre = ColumnTransformer([
        ("num", StandardScaler(), num),
        ("cat", OneHotEncoder(handle_unknown="ignore"), cat),
    ])
    return Pipeline([("pre", pre), ("model", LinearRegression())])


def main():
    df = load_data()
    num, cat = feature_cols(df)
    Xtr, Xte, ytr, yte = split_xy(df, TARGET_SALES)
    pipe = build(num, cat).fit(Xtr, ytr)
    pred = pipe.predict(Xte)

    r2 = r2_score(yte, pred)
    mae = mean_absolute_error(yte, pred)
    rmse = root_mean_squared_error(yte, pred)
    print("=" * 56)
    print("ML v1 · 매출 예측 (Linear Regression)")
    print("=" * 56)
    print(f"R²   : {r2:.3f}")
    print(f"MAE  : {mae:,.0f} 만원")
    print(f"RMSE : {rmse:,.0f} 만원")
    print(f"(평균 매출 {yte.mean():,.0f} 만원 대비 MAE {mae/yte.mean():.1%})")

    path = ARTIFACT_DIR / "v1_sales_linear.joblib"
    joblib.dump(pipe, path)
    print("저장:", path.name)
    return {"r2": r2, "mae": mae, "rmse": rmse}


if __name__ == "__main__":
    main()
