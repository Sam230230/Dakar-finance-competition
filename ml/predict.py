"""
통합 추론 — 학습된 모델을 로드해 한 후보 입지에 대해 예측.
Stay/Move 규칙엔진에 '예측 매출'과 '폐업확률'을 입력으로 넣을 때 이 함수를 쓴다.
"""
from __future__ import annotations

from pathlib import Path

import joblib
import pandas as pd

from features import ARTIFACT_DIR, FEATURES
from relocation_trajectory import project

_cache = {}


def _load(name):
    if name not in _cache:
        p = ARTIFACT_DIR / name
        _cache[name] = joblib.load(p) if p.exists() else None
    return _cache[name]


def predict_site(site: dict, use_gbm: bool = True) -> dict:
    """
    site: FEATURES 컬럼을 담은 dict (flow_pop, work_pop, ..., signgu, svc_induty, change_idx)
    반환: 예상 월매출, 폐업확률, 이전 후 매출 궤적.
    """
    X = pd.DataFrame([{k: site.get(k) for k in FEATURES}])

    reg = _load("v2_sales_gbm.joblib") if use_gbm else _load("v1_sales_linear.joblib")
    reg = reg or _load("v1_sales_linear.joblib")
    pred_sales = float(reg.predict(X)[0]) if reg else None

    clf = _load("v3_closure_clf.joblib")
    closure = float(1 - clf.predict_proba(X)[0, 1]) if clf else None

    traj = project(pred_sales) if pred_sales else []
    return {
        "predicted_monthly_sales": round(pred_sales) if pred_sales else None,
        "closure_probability": round(closure, 3) if closure is not None else None,
        "relocation_trajectory": traj,
    }


if __name__ == "__main__":
    demo = {"flow_pop": 12000, "work_pop": 9000, "resident_pop": 7000, "store_cnt": 8,
            "open_rate": 9.0, "close_rate": 6.0, "competitor_cnt": 5, "rent": 18.0,
            "signgu": "마포구", "svc_induty": "커피-음료", "change_idx": "HL",
            # 실데이터(ML_REAL=1) 모델용 시계열 피처
            "prev_sales": 165000, "yoy_sales": 150000, "season": 2}
    import json
    r = predict_site(demo)
    print("입력 후보 예측:")
    print(f"  예상 월매출 : {r['predicted_monthly_sales']:,}만원")
    print(f"  폐업 확률   : {r['closure_probability']*100:.1f}%")
    print(f"  3개월 후 매출: {r['relocation_trajectory'][2]['sales']:,}만원 "
          f"({r['relocation_trajectory'][2]['ratio']*100:.0f}%)")
