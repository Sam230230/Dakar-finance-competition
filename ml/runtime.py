"""Runtime ML adapter for Stay or Move.

Serving model: ml/artifacts/real/* — trained on real Seoul commercial-area data
(see ml/train_real.py). Legacy synthetic-data models (ml/artifacts/synthetic_backup/)
are kept only as an emergency fallback if the real artifacts fail to load, and are
flagged loudly (model_source="synthetic_fallback") whenever used.

Why a two-stage prediction instead of one TRDAR-level model: the real source data has
a genuine multi-quarter (21-quarter) sales time series only at district (자치구) grain;
TRDAR_CD-level sales exist only as a single-quarter snapshot (see data_sources.seoul_market).
So: (1) a real time-series model predicts next-quarter district-wide sales, leak-safe
(lag features only); (2) that district total is redistributed to the specific candidate's
TRDAR_CD using its real, observed share of district sales/store-count from the single
snapshot. No TRDAR-level time series is fabricated.

Performance design: models/artifacts loaded once per process (lru_cache); no training,
no external API call happens during /staymove.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parent
ARTIFACT_DIR = ROOT / "artifacts"
REAL_DIR = ARTIFACT_DIR / "real"
SYNTH_DIR = ARTIFACT_DIR / "synthetic_backup"
DATA_DIR = ROOT / "data"
PROJECT_ROOT = ROOT.parent

DEFAULT_STORE_COUNT = 8.0  # 자치구 스냅샷도 전혀 없을 때만 쓰는 최후 폴백(과거 synth 기본값과 동일)


# ───────────────────────── geo crosswalk (TRDAR_CD <-> 자치구) ─────────────────────────

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


@lru_cache(maxsize=1)
def _district_to_trdars() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for code, district in _geo_district_map().items():
        out.setdefault(district, []).append(code)
    return out


def _quarter_add(q: int, n: int) -> int:
    """STDR_YYQU_CD encoding is YYYYQ (e.g. 20261=2026 Q1). Add n quarters with year carry."""
    year, qtr = divmod(q, 10)
    total = (qtr - 1) + n
    year += total // 4
    qtr = total % 4 + 1
    return year * 10 + qtr


# ───────────────────────── real model artifacts ─────────────────────────

@lru_cache(maxsize=1)
def _real_metadata() -> Optional[dict]:
    path = REAL_DIR / "real_model_metadata.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _real_models() -> dict:
    out = {}
    for key, filename in [("lightgbm", "real_sales_lightgbm.joblib"), ("linear", "real_sales_linear.joblib")]:
        path = REAL_DIR / filename
        out[key] = joblib.load(path) if path.exists() else None
    return out


@lru_cache(maxsize=1)
def _district_panel() -> pd.DataFrame:
    path = REAL_DIR / "district_panel_real.csv"
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path)


@lru_cache(maxsize=1)
def _real_trend() -> pd.DataFrame:
    path = REAL_DIR / "region_trend_real.csv"
    return pd.read_csv(path) if path.exists() else pd.DataFrame()


@lru_cache(maxsize=1)
def _real_retention() -> pd.DataFrame:
    path = REAL_DIR / "retention_yoy_real.csv"
    return pd.read_csv(path) if path.exists() else pd.DataFrame()


def _district_sales_at(panel: pd.DataFrame, district: str, quarter: int) -> Optional[float]:
    row = panel[(panel["signgu"] == district) & (panel["stdr_yyqu"] == quarter)]
    return float(row.iloc[0]["monthly_sales"]) if not row.empty else None


def _build_next_quarter_features(district: str) -> Optional[dict]:
    """실제 district_panel(21분기 중 leak-safe하게 남은 17분기)의 최신 분기 바로 다음 분기를
    예측 대상으로 삼아, 그 시점 기준 prev_sales/yoy_sales/인구 피처를 실측값으로 구성한다."""
    panel = _district_panel()
    if panel.empty:
        return None
    sub = panel[panel["signgu"] == district]
    if sub.empty:
        return None
    latest_q = int(sub["stdr_yyqu"].max())
    latest_row = sub[sub["stdr_yyqu"] == latest_q].iloc[0]
    next_q = _quarter_add(latest_q, 1)
    yoy_q = _quarter_add(next_q, -4)
    yoy_sales = _district_sales_at(panel, district, yoy_q)
    if yoy_sales is None:
        return None
    return {
        "signgu": district,
        "season": next_q % 10,
        "prev_sales": float(latest_row["monthly_sales"]),
        "yoy_sales": yoy_sales,
        "flow_pop": float(latest_row["flow_pop"]),
        "work_pop": float(latest_row["work_pop"]),
        "resident_pop": float(latest_row["resident_pop"]),
        "target_quarter": next_q,
        "basis_quarter": latest_q,
    }


def _predict_district_sales(district: str) -> Optional[dict]:
    features = _build_next_quarter_features(district)
    if features is None:
        return None
    models = _real_models()
    model = models.get("lightgbm") or models.get("linear")
    if model is None:
        return None
    frame = pd.DataFrame([{k: v for k, v in features.items() if k not in ("target_quarter", "basis_quarter")}])
    predicted = float(model.predict(frame)[0])
    model_name = "LightGBM" if models.get("lightgbm") is not None else "Linear"
    return {"predicted_district_sales": predicted, "model_name": model_name, **features}


# ───────────────────────── TRDAR-level redistribution (real single-quarter snapshot) ─────────────────────────

def _trdar_share_and_store_count(trdar_cd: Optional[str], district: Optional[str], industry_code: str) -> dict:
    """이 상권(TRDAR)이 자치구 전체 매출/점포수에서 차지하는 실측 비중.
    2025Q4/2024Q4 스냅샷(시계열 아님)을 그대로 쓰는 산수 — 새로운 값을 만들지 않는다."""
    from data_sources.seoul_market import district_totals, lookup_metric

    trdars_in_district = _district_to_trdars().get(district, []) if district else []
    totals = district_totals(trdars_in_district, industry_code)
    n_trdars = len(trdars_in_district) or 1

    row = lookup_metric(str(trdar_cd), industry_code) if trdar_cd else None
    if row and totals["total_sales_amt"]:
        share = (row.sales_amt_current or 0) / totals["total_sales_amt"]
        store_count = row.store_count or (totals["total_store_count"] / max(totals["n_trdar_with_data"], 1))
        return {"share": share, "store_count": store_count or DEFAULT_STORE_COUNT, "data_completeness": "trdar_exact"}

    # 이 TRDAR엔 스냅샷이 없음 — 자치구 균등 배분으로 폴백(있는 그대로 명시).
    share = 1.0 / n_trdars
    store_count = (totals["total_store_count"] / max(totals["n_trdar_with_data"], 1)) if totals["n_trdar_with_data"] else DEFAULT_STORE_COUNT
    return {"share": share, "store_count": store_count, "data_completeness": "district_fallback"}


# ───────────────────────── real observed market indicators (not a model prediction) ─────────────────────────

def _district_sales_history(district: Optional[str], n: int = 8) -> list[dict]:
    """최근 n분기 자치구 동종업종(커피-음료) 실제 매출 시계열 — 라인차트용.
    상권(TRDAR) 단위가 아니라 자치구 단위 실측값임을 호출부가 라벨에 명시해야 한다."""
    if not district:
        return []
    panel = _district_panel()
    if panel.empty:
        return []
    sub = panel[panel["signgu"] == district].sort_values("stdr_yyqu").tail(n)
    return [{"quarter": int(r.stdr_yyqu), "monthly_sales": round(float(r.monthly_sales))} for r in sub.itertuples()]


def market_observed(trdar_cd: Optional[str], industry_code: str, district: Optional[str]) -> dict:
    from data_sources.seoul_market import lookup_metric

    row = lookup_metric(str(trdar_cd), industry_code) if trdar_cd else None
    trend_row = None
    if district:
        trend = _real_trend()
        if not trend.empty:
            match = trend[trend["signgu"] == district]
            if not match.empty:
                trend_row = match.iloc[0]

    trend_pct = float(trend_row["quarterly_growth_pct"]) if trend_row is not None else None
    trend_label = str(trend_row["trend"]) if trend_row is not None else None
    sales_history = _district_sales_history(district)

    if not row:
        return {
            "status": "no_snapshot", "close_rate": None, "open_rate": None, "sales_yoy": None,
            "avg_open_months": None, "avg_closed_months": None,
            "sales_trend": trend_label, "sales_trend_pct": trend_pct, "sales_history": sales_history,
            "sales_history_grain": "district",
        }
    return {
        "status": "ok",
        "close_rate": row.closure_rate,
        "open_rate": row.open_rate,
        "sales_yoy": round(row.sales_yoy, 1) if row.sales_yoy is not None else None,
        "sales_trend_pct": trend_pct,
        "avg_open_months": row.avg_open_months,
        "avg_closed_months": row.avg_closed_months,
        "sales_trend": trend_label,
        "sales_history": sales_history,
        "sales_history_grain": "district",
        "snapshot_period": {"sales": row.sales_period, "stores": row.store_period, "change": row.change_period},
    }


# ───────────────────────── legacy synthetic fallback (only if real artifacts missing) ─────────────────────────

@lru_cache(maxsize=1)
def _synthetic_models() -> dict:
    out = {}
    for key, filename in [("sales_linear", "v1_sales_linear.joblib"), ("sales_gbm", "v2_sales_gbm.joblib")]:
        path = SYNTH_DIR / filename
        out[key] = joblib.load(path) if path.exists() else None
    return out


@lru_cache(maxsize=1)
def _synthetic_training_defaults() -> pd.DataFrame:
    path = DATA_DIR / "sanggwon_synth.csv"
    return pd.read_csv(path) if path.exists() else pd.DataFrame()


def _predict_synthetic_fallback(district: Optional[str], industry: str) -> Optional[dict]:
    models = _synthetic_models()
    reg = models.get("sales_gbm") or models.get("sales_linear")
    if reg is None:
        return None
    df = _synthetic_training_defaults()
    if df.empty:
        row = {"flow_pop": 12000.0, "work_pop": 9000.0, "resident_pop": 7000.0, "store_cnt": 8.0,
               "open_rate": 8.0, "close_rate": 6.0, "competitor_cnt": 5.0, "rent": 18.0, "change_idx": "HL"}
    else:
        sub = df[df["signgu"] == district] if district and (df["signgu"] == district).any() else df
        nums = ["flow_pop", "work_pop", "resident_pop", "store_cnt", "open_rate", "close_rate", "competitor_cnt", "rent"]
        row = {c: float(pd.to_numeric(sub[c], errors="coerce").median()) for c in nums if c in sub.columns}
        mode = sub["change_idx"].mode() if "change_idx" in sub.columns else pd.Series(dtype=object)
        row["change_idx"] = str(mode.iloc[0]) if not mode.empty else "HL"
    row["signgu"] = district or "마포구"
    row["svc_induty"] = industry
    frame = pd.DataFrame([row])
    predicted = float(reg.predict(frame)[0])
    return {"predicted_monthly_sales": round(predicted), "model_name": "v2_sales_gbm(synthetic)" if models.get("sales_gbm") is not None else "v1_sales_linear(synthetic)"}


# ───────────────────────── public entry point ─────────────────────────

@lru_cache(maxsize=8)
def _per_store_reference_percentiles(industry_code: str) -> Optional[dict]:
    """전체 상권(TRDAR) 실측 점포당 매출 분포(sqlite 스냅샷 그 자체) — 특정 예측이
    이 분포를 크게 벗어나면 pipeline 버그가 아니라 정말 그런 상권이 있다는 뜻인지
    구분하는 sanity-check 기준선. 자치구 하드코딩이 아니라 전체 분포 기반."""
    from data_sources.seoul_market import per_store_sales_values

    values = per_store_sales_values(industry_code)
    if not values:
        return None
    s = pd.Series(values)
    return {"p50": s.quantile(0.5), "p90": s.quantile(0.9), "p95": s.quantile(0.95), "p99": s.quantile(0.99), "n": len(s)}


def _check_outlier(per_store_value: float, industry_code: str) -> dict:
    ref = _per_store_reference_percentiles(industry_code)
    if ref is None:
        return {"prediction_outlier": False, "reason": None}
    # p99를 넘거나(고밀도 관광특구 등 실제 상위 1% 상권), 실측 분포 최소값보다도 한참 작으면
    # (비정상적으로 낮음) 플래그. 절대 clamp하지 않는다 — 플래그와 근거만 남긴다(사용자 명시 지침).
    if per_store_value > ref["p99"]:
        return {"prediction_outlier": True, "reason": f"실측 상권 점포당 매출 분포의 상위 1%(p99={ref['p99']:,.0f}만원) 초과 (n={ref['n']})"}
    if per_store_value < ref["p50"] * 0.05:
        return {"prediction_outlier": True, "reason": f"실측 상권 점포당 매출 분포의 p50({ref['p50']:,.0f}만원)의 5% 미만으로 비정상적으로 낮음 (n={ref['n']})"}
    return {"prediction_outlier": False, "reason": None}


def predict_candidate(
    *,
    trdar_cd: Optional[str],
    district: Optional[str],
    industry: str = "커피-음료",
    industry_code: str = "CS100010",
) -> dict:
    """A single candidate's ML prediction + real observed market indicators.

    Returns {"ml": {...}, "market_observed": {...}} — kept as two separate top-level
    keys so the API/UI never conflates a model estimate with an observed real value.
    """
    code = str(trdar_cd) if trdar_cd else None
    district = district or (_geo_district_map().get(code) if code else None)

    district_pred = _predict_district_sales(district) if district else None

    if district_pred is not None:
        redistribution = _trdar_share_and_store_count(code, district, industry_code)
        per_store = (district_pred["predicted_district_sales"] * redistribution["share"]) / redistribution["store_count"]
        metadata = _real_metadata() or {}
        outlier = _check_outlier(per_store, industry_code)
        if outlier["prediction_outlier"]:
            import logging
            logging.getLogger(__name__).warning(
                "ML prediction_outlier: trdar=%s district=%s per_store=%.0f만원 — %s",
                code, district, per_store, outlier["reason"],
            )
        ml = {
            "status": "ok",
            "predicted_monthly_sales": round(per_store),
            "model_source": "real",
            "model_name": district_pred["model_name"],
            "data_completeness": redistribution["data_completeness"],
            "district_used_for_prediction": district,
            "basis_quarter": district_pred["basis_quarter"],
            "target_quarter": district_pred["target_quarter"],
            "metrics": (metadata.get("metrics") or {}).get("test"),
            "prediction_outlier": outlier["prediction_outlier"],
            "outlier_reason": outlier["reason"],
            "caution": (
                "예상매출은 서울시 실제 상권 데이터를 기반으로 학습한 모델의 추정치입니다."
                if redistribution["data_completeness"] == "trdar_exact" else
                "이 상권은 자치구 단위 평균으로 대체 추정한 값입니다(해당 상권의 개별 매출 스냅샷 없음)."
            ),
        }
        if outlier["prediction_outlier"]:
            ml["caution"] += f" 참고: 이 상권은 실측 매출밀도 분포에서 통계적으로 매우 극단적인 값입니다({outlier['reason']}) — 임의로 보정하지 않고 원값 그대로 표시합니다."
    else:
        fallback = _predict_synthetic_fallback(district, industry)
        ml = {
            "status": "ok" if fallback else "model_unavailable",
            "predicted_monthly_sales": fallback["predicted_monthly_sales"] if fallback else None,
            "model_source": "synthetic_fallback",
            "model_name": fallback["model_name"] if fallback else None,
            "data_completeness": "synthetic_fallback",
            "caution": (
                "⚠ 실제 상권 데이터 기반 모델을 불러오지 못해 합성(시뮬레이션) 데이터로 학습된 예전 모델을 "
                "임시로 사용했습니다. 이 예측은 실제 서울 상권 데이터와 무관하니 참고하지 마세요."
            ),
        }

    observed = market_observed(code, industry_code, district)
    return {"ml": ml, "market_observed": observed, "trdar_cd": code, "district": district}


def warmup() -> dict:
    """Load model/data caches once. Safe to call at FastAPI startup."""
    real_ok = any(v is not None for v in _real_models().values())
    _district_panel()
    _real_trend()
    _real_retention()
    _geo_district_map()
    _district_to_trdars()
    if not real_ok:
        _synthetic_models()
        _synthetic_training_defaults()
    return {"real_model_loaded": real_ok}
