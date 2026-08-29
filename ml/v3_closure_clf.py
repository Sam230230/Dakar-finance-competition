"""
ML v3 — 폐업(생존) 확률 예측 (분류).
- 목적: '이 업종이 이 자리에서 2년 생존할 확률'을 예측해 리스크 경고 강화.
- 타깃: survived_2y (1=생존). 출력은 폐업확률 = 1 - P(생존).
- LightGBM 우선, 없으면 HistGradientBoosting 폴백. 클래스 불균형 보정.
실행: python v3_closure_clf.py
"""
from __future__ import annotations

import joblib
import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.metrics import (classification_report, confusion_matrix, f1_score,
                             roc_auc_score)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from features import (ARTIFACT_DIR, TARGET_SURVIVE, feature_cols, load_data, split_xy)

try:
    from lightgbm import LGBMClassifier
    def _clf():
        return LGBMClassifier(n_estimators=500, learning_rate=0.03, num_leaves=31,
                              subsample=0.8, colsample_bytree=0.8, class_weight="balanced",
                              random_state=42, verbose=-1)
    BACKEND = "LightGBM"
except Exception:
    from sklearn.ensemble import HistGradientBoostingClassifier
    def _clf():
        return HistGradientBoostingClassifier(max_iter=500, learning_rate=0.05,
                                              class_weight="balanced", random_state=42)
    BACKEND = "HistGradientBoosting(sklearn)"


def build(num, cat) -> Pipeline:
    pre = ColumnTransformer([
        ("num", "passthrough", num),
        ("cat", OneHotEncoder(handle_unknown="ignore"), cat),
    ])
    return Pipeline([("pre", pre), ("model", _clf())])


def main():
    df = load_data()
    num, cat = feature_cols(df)
    Xtr, Xte, ytr, yte = split_xy(df, TARGET_SURVIVE)
    pipe = build(num, cat).fit(Xtr, ytr)
    proba_survive = pipe.predict_proba(Xte)[:, 1]
    pred = (proba_survive >= 0.5).astype(int)

    auc = roc_auc_score(yte, proba_survive)
    f1 = f1_score(yte, pred)
    print("=" * 56)
    print(f"ML v3 · 폐업/생존 예측 ({BACKEND})")
    print("=" * 56)
    print(f"ROC-AUC : {auc:.3f}")
    print(f"F1      : {f1:.3f}")
    print(f"생존율(실제): {yte.mean():.1%}")
    print("\n[혼동행렬] (행=실제, 열=예측)")
    print(confusion_matrix(yte, pred))
    print("\n[분류 리포트]")
    print(classification_report(yte, pred, target_names=["폐업(0)", "생존(1)"]))

    path = ARTIFACT_DIR / "v3_closure_clf.joblib"
    joblib.dump(pipe, path)
    print("저장:", path.name, "→ 폐업확률 = 1 - P(생존)")
    return {"auc": auc, "f1": f1, "backend": BACKEND}


if __name__ == "__main__":
    main()
