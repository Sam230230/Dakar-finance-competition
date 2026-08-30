"""
ML v2 — 후보 입지 월매출 예측 (Gradient Boosted Trees, 고도화).
- 왜 GBM: 서울 상권 데이터는 테이블형·중간규모 → 부스팅 트리가 딥러닝을 이김. 비선형·상호작용 포착.
- 해석: SHAP로 '이 예측에서 어떤 피처가 얼마나 기여했는지' 설명(우리 제품의 근거제시 원칙).
- LightGBM 우선, 없으면 sklearn HistGradientBoosting 로 자동 폴백.
실행: python v2_sales_gbm.py
"""
from __future__ import annotations

import os

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.metrics import mean_absolute_error, r2_score, root_mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from features import (ARTIFACT_DIR, TARGET_SALES, feature_cols, load_data, split_xy)

try:
    from lightgbm import LGBMRegressor
    def _reg():
        return LGBMRegressor(n_estimators=600, learning_rate=0.03, num_leaves=31,
                             subsample=0.8, colsample_bytree=0.8, random_state=42, verbose=-1)
    BACKEND = "LightGBM"
except Exception:  # 폴백
    from sklearn.ensemble import HistGradientBoostingRegressor
    def _reg():
        return HistGradientBoostingRegressor(max_iter=600, learning_rate=0.05, random_state=42)
    BACKEND = "HistGradientBoosting(sklearn)"


def build(num, cat) -> Pipeline:
    pre = ColumnTransformer([
        ("num", "passthrough", num),
        ("cat", OneHotEncoder(handle_unknown="ignore"), cat),
    ])
    return Pipeline([("pre", pre), ("model", _reg())])


def _top_features(pipe, Xte, k=10):
    """상위 피처 중요도. 기본은 '모델 내장 중요도'(즉시). SHAP 은 SM_SHAP=1 일 때만(느림)."""
    pre = pipe.named_steps["pre"]
    model = pipe.named_steps["model"]
    names = list(pre.get_feature_names_out())

    if os.getenv("SM_SHAP") == "1":
        try:
            import shap
            Xt = pre.transform(Xte)[:150]                       # 샘플 축소로 과도한 지연 방지
            imp = np.abs(shap.TreeExplainer(model).shap_values(Xt)).mean(axis=0)
            label = "SHAP"
        except Exception as e:  # noqa: BLE001
            imp = getattr(model, "feature_importances_", None)
            label = "내장중요도(SHAP실패: " + str(e)[:30] + ")"
    else:
        imp = getattr(model, "feature_importances_", None)      # LightGBM/HistGBM 즉시 제공
        label = "내장 중요도"

    if imp is None:
        return label, []
    order = np.argsort(imp)[::-1][:k]
    return label, [(names[i].split("__")[-1], float(imp[i])) for i in order]


def main():
    df = load_data()
    num, cat = feature_cols(df)
    Xtr, Xte, ytr, yte = split_xy(df, TARGET_SALES)
    pipe = build(num, cat).fit(Xtr, ytr)
    pred = pipe.predict(Xte)

    r2, mae = r2_score(yte, pred), mean_absolute_error(yte, pred)
    rmse = root_mean_squared_error(yte, pred)
    print("=" * 56)
    print(f"ML v2 · 매출 예측 ({BACKEND})")
    print("=" * 56)
    print(f"R²   : {r2:.3f}")
    print(f"MAE  : {mae:,.0f} 만원  ({mae/yte.mean():.1%} of 평균)")
    print(f"RMSE : {rmse:,.0f} 만원")

    label, tops = _top_features(pipe, Xte)
    print(f"\n[매출에 영향 큰 피처 · {label}]")
    for name, val in tops:
        print(f"  {name:<18} {val:,.0f}")

    path = ARTIFACT_DIR / "v2_sales_gbm.joblib"
    joblib.dump(pipe, path)
    print("\n저장:", path.name)
    return {"r2": r2, "mae": mae, "rmse": rmse, "backend": BACKEND}


if __name__ == "__main__":
    main()
