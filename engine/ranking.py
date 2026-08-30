"""Deterministic candidate ranking — no LLM, no opaque weighted score.

Order of decision (per product spec):
  1. Viability: ML predicted sales >= minimum required sales.
  2. If cost_recovery: predicted sales must also clear the selected
     target-recovery-period required sales.
  3. Among viable candidates, rank by sales buffer ratio (desc).
  4. Tie-break: lower additional_fund_needed.
  5. Tie-break: real observed market indicators (closure rate, YoY sales, sales trend —
     from market_observed, not a model prediction; see staymove.py::market_observed).
  6. Tie-break: policy RAG hit count (supporting signal only, never a promoter).
  7. Final tie-break: site_id, for reproducibility.

Growth_opportunity candidates always carry secondary/reference recovery
figures (see staymove.py's recovery_relevance field) — step 2 is gated on
analysis_mode, not on field presence, so that display fix never changes
ranking behaviour for growth candidates.
"""
from __future__ import annotations

from typing import Any, Optional

_VIABLE_ORDER = {True: 0, "unknown": 1, False: 2}


def _selected_target_period(candidate: dict) -> Optional[dict]:
    return next((t for t in candidate.get("target_periods") or [] if t.get("selected")), None)


def _predicted_sales(candidate: dict) -> Optional[float]:
    ml = candidate.get("ml") or {}
    value = ml.get("predicted_monthly_sales")
    return float(value) if isinstance(value, (int, float)) else None


def _viability(candidate: dict) -> Any:
    predicted = _predicted_sales(candidate)
    min_required = candidate.get("min_required_sales")
    if predicted is None or min_required is None:
        return "unknown"
    if predicted < min_required:
        return False
    if candidate.get("analysis_mode") == "cost_recovery":
        target = _selected_target_period(candidate)
        if target is not None and predicted < target.get("required_sales", 0):
            return False
    return True


def _sales_buffer_ratio(candidate: dict) -> Optional[float]:
    predicted = _predicted_sales(candidate)
    min_required = candidate.get("min_required_sales")
    if predicted is None or not min_required:
        return None
    return (predicted - min_required) / min_required


def _neutral_sort_key(candidate: dict) -> tuple:
    """More negative/lower is 'better' throughout, so plain ascending sort works."""
    viable = _viability(candidate)
    buffer_ratio = _sales_buffer_ratio(candidate)
    # Missing buffer info sorts after any real number within the same viability bucket.
    buffer_rank = -buffer_ratio if buffer_ratio is not None else float("inf")

    # Real observed indicators (not model output) — see staymove.py::market_observed.
    observed = candidate.get("market_observed") or {}
    closure = observed.get("close_rate")
    closure_rank = closure if isinstance(closure, (int, float)) else 50.0  # neutral midpoint (0-100 scale)

    yoy = observed.get("sales_yoy")
    yoy_rank = -yoy if isinstance(yoy, (int, float)) else 0.0  # neutral

    trend_label = observed.get("sales_trend")
    trend_score = {"상승": 1, "보합": 0, "하락": -1}.get(trend_label, 0)
    trend_rank = -trend_score

    policy_count = len((candidate.get("policy_rag") or {}).get("results") or [])

    return (
        _VIABLE_ORDER.get(viable, 1),
        buffer_rank,
        candidate.get("additional_fund_needed", 0.0),
        closure_rank,
        yoy_rank,
        trend_rank,
        -policy_count,
        candidate.get("site_id", ""),
    )


def rank_candidates(candidates: list[dict]) -> dict:
    if not candidates:
        return {
            "ranking": [], "recommended_candidate": None, "confidence": "conditional",
            "all_below_threshold": False,
            "viable": {}, "sales_buffer_ratio": {}, "reasons": {},
        }

    ordered = sorted(candidates, key=_neutral_sort_key)
    ranking = [c["site_id"] for c in ordered]
    recommended = ranking[0]

    viable_map = {c["site_id"]: _viability(c) for c in candidates}
    buffer_map = {c["site_id"]: _sales_buffer_ratio(c) for c in candidates}

    confidence = "strong" if viable_map[recommended] is True else "conditional"
    # True only when every candidate explicitly fails the business-viability threshold
    # (not just "unknown" due to missing ML) — UI must not say "추천" in this case.
    all_below_threshold = bool(candidates) and all(v is False for v in viable_map.values())

    # Rank among candidates that actually have a buffer ratio (None sorts last, no rank).
    with_buffer = sorted(
        (sid for sid, v in buffer_map.items() if v is not None),
        key=lambda sid: buffer_map[sid],
        reverse=True,
    )
    buffer_rank_map = {sid: i + 1 for i, sid in enumerate(with_buffer)}

    reasons = {}
    for c in candidates:
        sid = c["site_id"]
        target = _selected_target_period(c) if c.get("analysis_mode") == "cost_recovery" else None
        predicted = _predicted_sales(c)
        reasons[sid] = {
            "viable": viable_map[sid],
            "meets_recovery_target": (
                None if target is None or predicted is None
                else predicted >= target.get("required_sales", 0)
            ),
            "sales_buffer_ratio": buffer_map[sid],
            # 1-indexed rank among candidates by sales_buffer_ratio alone — lets the UI/LLM
            # cite *why* the ranking landed this way (e.g. "B는 매출여유율 1위") instead of
            # just asserting an order, per the ranking-transparency requirement.
            "sales_buffer_rank": buffer_rank_map.get(sid),
            "additional_fund_needed": c.get("additional_fund_needed"),
        }

    return {
        "ranking": ranking,
        "recommended_candidate": recommended,
        "confidence": confidence,
        "all_below_threshold": all_below_threshold,
        "viable": viable_map,
        "sales_buffer_ratio": buffer_map,
        "reasons": reasons,
    }
