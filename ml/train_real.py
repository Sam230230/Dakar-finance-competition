"""
실데이터(자치구×커피-음료×분기) 매출예측 재학습 — synthetic 대체.

실행: cd ml && python3 train_real.py

파이프라인: real_loader.build_real() 로드 → 시간기반 split(최신 분기=Test,
그 전 분기=Validation, 나머지=Train) → Linear(baseline) + LightGBM(main) 학습 →
MAE/RMSE/R²/sMAPE 비교 → 최종 모델 + metadata를 ml/artifacts/real/ 에 저장 →
region_trend/retention_yoy도 이 실데이터로 재계산해 같은 폴더에 저장.

random_state=42 고정, 무작위 train/test split을 쓰지 않는다(시계열이므로).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score, root_mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from data.real_loader import build_real
from features import feature_cols
from retention_trend import region_trend, yoy_retention

try:
    from lightgbm import LGBMRegressor
    def _lgbm():
        return LGBMRegressor(n_estimators=300, learning_rate=0.05, num_leaves=15,
                             min_child_samples=5, subsample=0.8, colsample_bytree=0.8,
                             random_state=42, verbose=-1)
    LGBM_BACKEND = "LightGBM"
except Exception:
    from sklearn.ensemble import HistGradientBoostingRegressor
    def _lgbm():
        return HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, random_state=42)
    LGBM_BACKEND = "HistGradientBoosting(sklearn)"

REAL_ARTIFACT_DIR = Path(__file__).parent / "artifacts" / "real"
REAL_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

TARGET = "monthly_sales"


def temporal_split(df: pd.DataFrame, time_col: str = "stdr_yyqu"):
    """무작위 split 금지 — 분기 순서대로 Train/Validation/Test로 자른다."""
    quarters = sorted(df[time_col].unique())
    if len(quarters) < 3:
        raise RuntimeError(f"시간기반 split에는 최소 3개 분기가 필요한데 {len(quarters)}개뿐입니다.")
    test_q, val_q = quarters[-1], quarters[-2]
    train = df[df[time_col] < val_q]
    val = df[df[time_col] == val_q]
    test = df[df[time_col] == test_q]
    return train, val, test, {"train_quarters": quarters[:-2], "val_quarter": val_q, "test_quarter": test_q}


def build_pipeline(num, cat, estimator) -> Pipeline:
    pre = ColumnTransformer([
        ("num", "passthrough", num),
        ("cat", OneHotEncoder(handle_unknown="ignore"), cat),
    ])
    return Pipeline([("pre", pre), ("model", estimator)])


def smape(y_true, y_pred) -> float:
    y_true, y_pred = np.asarray(y_true, dtype=float), np.asarray(y_pred, dtype=float)
    denom = np.abs(y_true) + np.abs(y_pred)
    denom = np.where(denom == 0, 1.0, denom)  # 둘 다 0인 행만 방어(이 데이터엔 없음)
    return float(np.mean(2 * np.abs(y_pred - y_true) / denom) * 100)


def evaluate(pipe, X, y) -> dict:
    pred = pipe.predict(X)
    return {
        "mae": round(mean_absolute_error(y, pred), 1),
        "rmse": round(root_mean_squared_error(y, pred), 1),
        "r2": round(r2_score(y, pred), 4),
        "smape": round(smape(y, pred), 2),
    }


def main():
    df = build_real()
    num, cat = feature_cols(df)
    print(f"[데이터] {df.shape[0]}행, 자치구 {df.signgu.nunique()}개, 피처: num={num} cat={cat}")

    train, val, test, split_info = temporal_split(df)
    print(f"[Split] train 분기={split_info['train_quarters']}")
    print(f"        validation 분기={split_info['val_quarter']} ({len(val)}행)")
    print(f"        test 분기={split_info['test_quarter']} ({len(test)}행)")

    Xtr, ytr = train[num + cat], train[TARGET]
    Xval, yval = val[num + cat], val[TARGET]
    Xtest, ytest = test[num + cat], test[TARGET]

    models = {
        "Linear": build_pipeline(num, cat, LinearRegression()),
        "LightGBM": build_pipeline(num, cat, _lgbm()),
    }

    results = {}
    for name, pipe in models.items():
        pipe.fit(Xtr, ytr)
        results[name] = {"pipeline": pipe, "val": evaluate(pipe, Xval, yval), "test": evaluate(pipe, Xtest, ytest)}

    print("\n| Model | MAE(val) | RMSE(val) | R²(val) | sMAPE(val) | MAE(test) | RMSE(test) | R²(test) | sMAPE(test) |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for name, r in results.items():
        v, t = r["val"], r["test"]
        print(f"| {name} | {v['mae']:,.0f} | {v['rmse']:,.0f} | {v['r2']} | {v['smape']}% "
              f"| {t['mae']:,.0f} | {t['rmse']:,.0f} | {t['r2']} | {t['smape']}% |")

    # validation MAE 기준으로 최종 서빙 모델 선택 — 숫자로 정하지 감으로 정하지 않는다.
    best_name = min(results, key=lambda n: results[n]["val"]["mae"])
    print(f"\n[선택] validation MAE 기준 최종 서빙 모델: {best_name} ({LGBM_BACKEND if best_name=='LightGBM' else 'sklearn'})")

    for name, r in results.items():
        joblib.dump(r["pipeline"], REAL_ARTIFACT_DIR / f"real_sales_{name.lower()}.joblib")

    metadata = {
        "model_name": best_name,
        "backend": LGBM_BACKEND if best_name == "LightGBM" else "sklearn.LinearRegression",
        "training_source": "Seoul commercial area actual data (자치구×커피-음료×분기 실제 추정매출 + 실측 인구)",
        "target": "자치구 전체 커피-음료 업종 당월 추정매출(만원) — 개별 상권 값은 runtime에서 상권별 매출 비중으로 재분배",
        "industry": "CS100010",
        "industry_name": "커피-음료",
        "grain": "signgu(자치구) x stdr_yyqu(분기)",
        "train_period": f"{split_info['train_quarters'][0]}~{split_info['train_quarters'][-1]}",
        "val_period": str(split_info["val_quarter"]),
        "test_period": str(split_info["test_quarter"]),
        "n_train": len(train), "n_val": len(val), "n_test": len(test),
        "features_num": num, "features_cat": cat,
        "metrics": {"validation": results[best_name]["val"], "test": results[best_name]["test"]},
        "all_models_compared": {n: {"val": r["val"], "test": r["test"]} for n, r in results.items()},
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "random_state": 42,
    }
    (REAL_ARTIFACT_DIR / "real_model_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n저장: {REAL_ARTIFACT_DIR}/real_sales_linear.joblib, real_sales_lightgbm.joblib, real_model_metadata.json")

    # region_trend / retention_yoy를 이 실데이터 프레임으로 재계산 (grain-agnostic 함수 재사용).
    full_for_trend = df.rename(columns={}).copy()
    full_for_trend["svc_induty"] = "커피-음료"  # region_trend()/yoy_retention()이 요구하는 컬럼명
    trend = region_trend(full_for_trend)
    ret = yoy_retention(full_for_trend)
    trend.to_csv(REAL_ARTIFACT_DIR / "region_trend_real.csv", index=False, encoding="utf-8")
    ret.to_csv(REAL_ARTIFACT_DIR / "retention_yoy_real.csv", index=False, encoding="utf-8")
    print(f"저장: region_trend_real.csv({len(trend)}행), retention_yoy_real.csv({len(ret)}행)")

    # runtime이 "다음 분기" 추론 피처(prev_sales/yoy_sales/최신 인구)를 만들 때 쓰는 원본 패널.
    # 매 요청마다 원본 JSON/CSV를 다시 읽지 않도록 서버 시작 시 1회만 로드하는 캐시.
    panel_cols = ["signgu", "stdr_yyqu", "monthly_sales", "flow_pop", "work_pop", "resident_pop"]
    df[panel_cols].to_csv(REAL_ARTIFACT_DIR / "district_panel_real.csv", index=False, encoding="utf-8")
    print(f"저장: district_panel_real.csv({len(df)}행) — runtime 추론용 최신 분기 조회 캐시")

    return metadata


if __name__ == "__main__":
    main()
