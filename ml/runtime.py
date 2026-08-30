"""Runtime ML adapter for Stay or Move.

The original ML_branch training artifacts are kept intact.  This module only
adapts service inputs (candidate address/TRDAR code + local Seoul datasets) to
those already-trained pipelines.

Performance design:
- joblib models are loaded once per backend process (lru_cache)
- population CSVs / trend artifacts are loaded once
- no training and no external API call happens during /staymove
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional
import json

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parent
ARTIFACT_DIR = ROOT / "artifacts"
DATA_DIR = ROOT / "data"
PROJECT_ROOT = ROOT.parent

MODEL_FILES = {
    "sales_linear": "v1_sales_linear.joblib",
    "sales_gbm": "v2_sales_gbm.joblib",
    "closure": "v3_closure_clf.joblib",
}


@lru_cache(maxsize=1)
def _models() -> dict:
    out = {}
    for key, filename in MODEL_FILES.items():
        path = ARTIFACT_DIR / filename
        out[key] = joblib.load(path) if path.exists() else None
    return out


@lru_cache(maxsize=1)
def _geo_district_map() -> dict[str, str]:
    path = PROJECT_ROOT / "data" / "sanggwon.geojson"
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    result = {}
    for feature in raw.get("features", []):
        props = feature.get("properties") or {}
        code = str(props.get("TRDAR_CD") or "")
        district = props.get("SIGNGU_CD_")
        if code and district:
            result[code] = str(district)
    return result


def _latest_by_code(path: Path, value_col: str) -> dict[str, float]:
    if not path.exists():
        return {}
    df = pd.read_csv(path, usecols=["STDR_YYQU_CD", "TRDAR_CD", value_col])
    df["TRDAR_CD"] = df["TRDAR_CD"].astype(str)
    df["STDR_YYQU_CD"] = pd.to_numeric(df["STDR_YYQU_CD"], errors="coerce")
    df[value_col] = pd.to_numeric(df[value_col], errors="coerce")
    df = df.dropna(subset=["STDR_YYQU_CD", value_col]).sort_values("STDR_YYQU_CD")
    latest = df.groupby("TRDAR_CD", as_index=False).tail(1)
    return dict(zip(latest["TRDAR_CD"], latest[value_col].astype(float)))


@lru_cache(maxsize=1)
def _population_maps() -> dict[str, dict[str, float]]:
    return {
        "flow_pop": _latest_by_code(DATA_DIR / "VwsmTrdarFlpopQq.csv", "TOT_FLPOP_CO"),
        "work_pop": _latest_by_code(DATA_DIR / "VwsmTrdarWrcPopltnQq.csv", "TOT_WRC_POPLTN_CO"),
        "resident_pop": _latest_by_code(DATA_DIR / "VwsmTrdarRepopQq.csv", "TOT_REPOP_CO"),
    }


@lru_cache(maxsize=1)
def _training_defaults() -> pd.DataFrame:
    path = DATA_DIR / "sanggwon_synth.csv"
    if not path.exists():
        return pd.DataFrame()
    df = pd.read_csv(path)
    return df


@lru_cache(maxsize=1)
def _region_trend() -> pd.DataFrame:
    path = ARTIFACT_DIR / "region_trend.csv"
    return pd.read_csv(path) if path.exists() else pd.DataFrame()


@lru_cache(maxsize=1)
def _retention_yoy() -> pd.DataFrame:
    path = ARTIFACT_DIR / "retention_yoy.csv"
    return pd.read_csv(path) if path.exists() else pd.DataFrame()


def _default_row(district: Optional[str], industry: str) -> dict:
    df = _training_defaults()
    if df.empty:
        return {
            "flow_pop": 12000.0, "work_pop": 9000.0, "resident_pop": 7000.0,
            "store_cnt": 8.0, "open_rate": 8.0, "close_rate": 6.0,
            "competitor_cnt": 5.0, "rent": 18.0, "change_idx": "HL",
        }
    sub = df.copy()
    if district and "signgu" in sub.columns and (sub["signgu"] == district).any():
        sub = sub[sub["signgu"] == district]
    if "svc_induty" in sub.columns and (sub["svc_induty"] == industry).any():
        sub = sub[sub["svc_induty"] == industry]
    if sub.empty:
        sub = df
    nums = ["flow_pop", "work_pop", "resident_pop", "store_cnt", "open_rate", "close_rate", "competitor_cnt", "rent"]
    out = {c: float(pd.to_numeric(sub[c], errors="coerce").median()) for c in nums if c in sub.columns}
    if "change_idx" in sub.columns:
        mode = sub["change_idx"].mode()
        out["change_idx"] = str(mode.iloc[0]) if not mode.empty else "HL"
    return out


def _market_metric(trdar_cd: Optional[str], industry_code: str) -> Optional[dict]:
    if not trdar_cd:
        return None
    try:
        from data_sources.seoul_market import lookup_metric
        metric = lookup_metric(str(trdar_cd), industry_code)
        return metric.to_dict() if metric else None
    except Exception:
        return None


def _trend_info(district: Optional[str], industry: str) -> dict:
    out = {"district_trend": None, "latest_yoy_retention": None}
    if district:
        trend = _region_trend()
        if not trend.empty:
            row = trend[trend["signgu"] == district]
            if not row.empty:
                r = row.iloc[0]
                out["district_trend"] = {
                    "quarterly_growth_pct": float(r["quarterly_growth_pct"]),
                    "trend": str(r["trend"]),
                    "avg_sales": float(r["avg_sales"]),
                }
        ret = _retention_yoy()
        if not ret.empty:
            rows = ret[(ret["signgu"] == district) & (ret["svc_induty"] == industry)].copy()
            if not rows.empty:
                rows["stdr_yyqu"] = pd.to_numeric(rows["stdr_yyqu"], errors="coerce")
                rows = rows.sort_values("stdr_yyqu")
                r = rows.iloc[-1]
                out["latest_yoy_retention"] = {
                    "period": int(r["stdr_yyqu"]),
                    "retention": float(r["retention"]),
                }
    return out


def _project(steady_sales: float, months: int = 12, r0: float = 0.70, tau: float = 3.0) -> list[dict]:
    # Same formula as ml/relocation_trajectory.py, kept here package-safe.
    import math
    result = []
    for t in range(months):
        ratio = 1 - (1 - r0) * math.exp(-t / tau)
        result.append({"month": t + 1, "ratio": round(ratio, 3), "sales": round(steady_sales * ratio)})
    return result


def predict_candidate(
    *,
    trdar_cd: Optional[str],
    district: Optional[str],
    industry: str = "커피-음료",
    industry_code: str = "CS100010",
) -> dict:
    """Run all service-relevant ML_branch outputs for one candidate.

    The stored models were trained on the original ML_branch feature schema.
    Real local Seoul signals are used where a TRDAR code is available; missing
    model features fall back to medians of the original training table so that
    inference stays inside the model's expected feature domain.
    """
    code = str(trdar_cd) if trdar_cd else None
    district = district or (_geo_district_map().get(code) if code else None)
    defaults = _default_row(district, industry)
    populations = _population_maps()
    market = _market_metric(code, industry_code)

    features = {
        "flow_pop": populations["flow_pop"].get(code, defaults.get("flow_pop", 12000.0)) if code else defaults.get("flow_pop", 12000.0),
        "work_pop": populations["work_pop"].get(code, defaults.get("work_pop", 9000.0)) if code else defaults.get("work_pop", 9000.0),
        "resident_pop": populations["resident_pop"].get(code, defaults.get("resident_pop", 7000.0)) if code else defaults.get("resident_pop", 7000.0),
        "store_cnt": float((market or {}).get("store_count") or defaults.get("store_cnt", 8.0)),
        "open_rate": float((market or {}).get("open_rate") or defaults.get("open_rate", 8.0)),
        "close_rate": float((market or {}).get("closure_rate") or defaults.get("close_rate", 6.0)),
        # Existing model expects a competitor feature.  Runtime has reliable TRDAR store count,
        # so use other same-industry stores as an explicit proxy rather than making an API call.
        "competitor_cnt": max(0.0, float((market or {}).get("store_count") or defaults.get("competitor_cnt", 5.0)) - 1.0),
        # ML_branch's rent feature is 만원/평, while onboarding rent is total monthly rent.
        # Do not mix units: use the original training-domain district/industry median proxy.
        "rent": float(defaults.get("rent", 18.0)),
        "signgu": district or "마포구",
        "svc_induty": industry,
        "change_idx": str((market or {}).get("change_index") or defaults.get("change_idx", "HL")),
    }

    models = _models()
    frame = pd.DataFrame([features])
    reg = models.get("sales_gbm") or models.get("sales_linear")
    pred_sales = float(reg.predict(frame)[0]) if reg is not None else None
    clf = models.get("closure")
    closure = float(1 - clf.predict_proba(frame)[0, 1]) if clf is not None else None

    trend = _trend_info(district, industry)
    return {
        "status": "ok" if pred_sales is not None else "model_unavailable",
        "model": "v2_sales_gbm" if models.get("sales_gbm") is not None else "v1_sales_linear",
        "predicted_monthly_sales": round(pred_sales) if pred_sales is not None else None,
        "closure_probability": round(closure, 3) if closure is not None else None,
        "relocation_trajectory": _project(pred_sales) if pred_sales is not None else [],
        "district_trend": trend["district_trend"],
        "latest_yoy_retention": trend["latest_yoy_retention"],
        "trdar_cd": code,
        "features": features,
        "feature_sources": {
            "flow_work_resident_population": "서울시 상권분석 CSV latest by TRDAR; training median fallback",
            "store_open_close_change": "local data/seoul_market.sqlite; training median fallback",
            "competitor_cnt": "same-industry TRDAR store_count - 1 proxy",
            "rent": "original ML_branch training-domain median proxy (만원/평); onboarding 월세와 단위 혼합 방지",
        },
        "caution": "ML_branch의 저장 모델은 추정치이며, 특히 폐업확률은 원본 프로젝트의 학습 라벨/가정 한계를 함께 확인해야 합니다.",
    }


def warmup() -> dict:
    """Load model/data caches once. Safe to call at FastAPI startup."""
    models = _models()
    _population_maps()
    _training_defaults()
    _region_trend()
    _retention_yoy()
    _geo_district_map()
    return {k: v is not None for k, v in models.items()}
