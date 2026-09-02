"""ML 실데이터 재학습 파이프라인 검증. 실행: cd ml && pytest test_real_pipeline.py -v"""
from __future__ import annotations

import json
import math
from pathlib import Path

import joblib
import pytest

ARTIFACT_DIR = Path(__file__).parent / "artifacts"
REAL_DIR = ARTIFACT_DIR / "real"
SYNTH_DIR = ARTIFACT_DIR / "synthetic_backup"

SYNTHETIC_FEATURE_SCHEMA = {
    "flow_pop", "work_pop", "resident_pop", "store_cnt",
    "open_rate", "close_rate", "competitor_cnt", "rent", "signgu", "svc_induty", "change_idx",
}


def _feature_names(pipeline) -> set[str]:
    return set(pipeline.named_steps["pre"].feature_names_in_)


# TEST 1 — 새 아티팩트의 feature_names_in_이 synthetic 스키마가 아니라 real 스키마인지.
def test_real_artifact_schema_is_not_synthetic():
    pipe = joblib.load(REAL_DIR / "real_sales_lightgbm.joblib")
    features = _feature_names(pipe)
    assert features == {"flow_pop", "work_pop", "resident_pop", "prev_sales", "yoy_sales", "signgu", "season"}
    assert not features.issubset(SYNTHETIC_FEATURE_SCHEMA)
    assert "prev_sales" in features and "yoy_sales" in features  # 합성 스키마엔 없던 실제 시계열 피처


def test_synthetic_backup_still_has_old_schema_untouched():
    pipe = joblib.load(SYNTH_DIR / "v2_sales_gbm.joblib")
    assert _feature_names(pipe) == SYNTHETIC_FEATURE_SCHEMA


# TEST 2 — metadata의 training_source가 실데이터인지.
def test_metadata_declares_real_training_source():
    meta = json.loads((REAL_DIR / "real_model_metadata.json").read_text(encoding="utf-8"))
    assert "actual data" in meta["training_source"] or "실제" in meta["training_source"]
    assert meta["industry"] == "CS100010"
    assert meta["n_train"] > 0 and meta["n_val"] > 0 and meta["n_test"] > 0
    assert "smape" in meta["metrics"]["test"]


# TEST 3 — 서로 다른 상권을 넣었을 때 같은 feature가 들어가지 않는지(실제로 값이 다른지).
def test_different_trdar_produce_different_predictions():
    from ml.runtime import predict_candidate
    a = predict_candidate(trdar_cd="3120100", district=None, industry_code="CS100010")  # 망원역
    b = predict_candidate(trdar_cd="3001491", district=None, industry_code="CS100010")  # 이태원 관광특구
    assert a["ml"]["predicted_monthly_sales"] != b["ml"]["predicted_monthly_sales"]
    assert a["district"] != b["district"]


def test_different_district_fallback_produce_different_predictions():
    from ml.runtime import predict_candidate
    a = predict_candidate(trdar_cd=None, district="강남구", industry_code="CS100010")
    b = predict_candidate(trdar_cd=None, district="성동구", industry_code="CS100010")
    assert a["ml"]["predicted_monthly_sales"] != b["ml"]["predicted_monthly_sales"]


# TEST 4 — NaN/Infinity 없음.
def test_prediction_has_no_nan_or_inf():
    from ml.runtime import predict_candidate
    r = predict_candidate(trdar_cd="3120100", district=None, industry_code="CS100010")
    value = r["ml"]["predicted_monthly_sales"]
    assert value is not None and math.isfinite(value)


# TEST 5 — 동일 입력 -> 동일 출력.
def test_prediction_is_deterministic():
    from ml.runtime import predict_candidate
    r1 = predict_candidate(trdar_cd="3120100", district=None, industry_code="CS100010")
    r2 = predict_candidate(trdar_cd="3120100", district=None, industry_code="CS100010")
    assert r1["ml"]["predicted_monthly_sales"] == r2["ml"]["predicted_monthly_sales"]


# TEST 7 (사용자 26번) — synthetic v3(폐업확률)가 결과에 전혀 쓰이지 않는지.
def test_no_closure_probability_field_from_synthetic_v3():
    from ml.runtime import predict_candidate
    r = predict_candidate(trdar_cd="3120100", district=None, industry_code="CS100010")
    assert "closure_probability" not in r["ml"]
    assert "closure_probability" not in r


# TEST 9 — 실제 폐업률/YoY/영업기간이 DB 실제 row와 동일하게 반환되는지.
def test_market_observed_matches_sqlite_row_exactly():
    from data_sources.seoul_market import lookup_metric
    from ml.runtime import predict_candidate
    row = lookup_metric("3120100", "CS100010")
    r = predict_candidate(trdar_cd="3120100", district=None, industry_code="CS100010")
    obs = r["market_observed"]
    assert obs["close_rate"] == row.closure_rate
    assert obs["open_rate"] == row.open_rate
    assert obs["avg_open_months"] == row.avg_open_months
    assert obs["avg_closed_months"] == row.avg_closed_months


def test_quarter_day_count_uses_calendar_days():
    from ml.runtime import _quarter_day_count
    assert _quarter_day_count(20261) == 90
    assert _quarter_day_count(20262) == 91
    assert _quarter_day_count(20263) == 92
    assert _quarter_day_count(20264) == 92
    assert _quarter_day_count(202401) == 91  # 윤년 1분기


def test_footfall_qoq_compares_daily_averages():
    from ml.runtime import _district_footfall
    observed = _district_footfall("마포구", n=2)
    history = observed["flow_pop_history"]
    assert len(history) == 2
    expected = round((history[-1]["daily"] / history[-2]["daily"] - 1) * 100, 1)
    assert observed["flow_pop_qoq_pct"] == expected


def test_no_hardcoded_district_branches_in_runtime_source():
    """범용성 요구사항 — 특정 자치구/후보에 대한 if-분기나 보정계수가 코드에 없어야 한다."""
    source = (Path(__file__).parent / "runtime.py").read_text(encoding="utf-8")
    forbidden = ["강남구", "성동구", 'site_id == "A"', "site_id=='A'"]
    for token in forbidden:
        assert token not in source, f"runtime.py에 하드코딩된 지역/후보 분기 발견: {token}"


def test_prediction_outlier_flag_on_real_extreme_commercial_zone():
    """강남 마이스 관광특구(코엑스 일대)는 sqlite 실측 기준 전체 1,069개 상권 중 매출밀도 2위 —
    pipeline이 이를 클램핑하지 않고 있는 그대로 반환하되 outlier로만 플래그하는지 확인."""
    from ml.runtime import predict_candidate
    r = predict_candidate(trdar_cd="3001496", district=None, industry_code="CS100010")
    assert r["ml"]["prediction_outlier"] is True
    assert r["ml"]["outlier_reason"] is not None
    assert r["ml"]["predicted_monthly_sales"] > 10000  # clamp 안 됐는지 — 값이 임의로 줄지 않았는지


def test_prediction_not_flagged_for_typical_commercial_zone():
    from ml.runtime import predict_candidate
    r = predict_candidate(trdar_cd="3120100", district=None, industry_code="CS100010")  # 망원역
    assert r["ml"]["prediction_outlier"] is False


def test_fallback_flagged_when_no_trdar_snapshot():
    from ml.runtime import predict_candidate
    r = predict_candidate(trdar_cd="0000000", district="마포구", industry_code="CS100010")
    assert r["ml"]["data_completeness"] == "district_fallback"
    assert r["market_observed"]["status"] == "no_snapshot"


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
