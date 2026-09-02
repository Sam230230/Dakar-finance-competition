"""Stay or Move — integrated Rule + ML + Policy RAG orchestrator.

2026-08 integration rules:
- No voluntary/involuntary onboarding question.
- Each candidate is classified independently from recurring monthly cost:
    growth_opportunity: candidate monthly cost > current monthly fixed cost
    cost_recovery:      candidate monthly cost <= current monthly fixed cost
- Recovery months (1~36) only affects cost_recovery candidates.
- Rule Engine remains deterministic.
- ML_branch artifacts/data are used as estimates, not replacements for Rule Engine.
- Policy RAG searches each candidate district independently.
- LLM explanation is ONE batch call for all candidates to reduce API latency.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import List, Optional

from pydantic import BaseModel, Field

from engine.rule_engine import CurrentStore, CandidateStore, compute
from engine.ranking import rank_candidates

logger = logging.getLogger(__name__)

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

SEOUL_DISTRICTS = [
    "강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구",
    "노원구", "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구",
    "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구",
]


def extract_district(text: str) -> Optional[str]:
    value = text or ""
    return next((d for d in SEOUL_DISTRICTS if d in value), None)


class CurrentStoreIn(BaseModel):
    address: str = ""
    monthly_sales: float
    variable_cost: float
    fixed_cost: float
    deposit: float = 0.0
    available_self_fund: float = 0.0
    # Legacy key accepted so older frontend payloads still work.
    available_cash: Optional[float] = None
    business_age_months: Optional[int] = Field(default=None, ge=0)

    @property
    def self_fund(self) -> float:
        return self.available_self_fund if self.available_self_fund else float(self.available_cash or 0.0)


class CandidateIn(BaseModel):
    site_id: str
    name: str
    trdar_cd: Optional[str] = None
    monthly_rent: float
    maintenance_fee: float = 0.0
    other_fixed_cost: float = 0.0
    deposit: float = 0.0
    interior_cost: float = 0.0
    moving_cost: float = 0.0
    restoration_cost: float = 0.0
    rights_fee: float = 0.0
    other_moving_cost: float = 0.0
    closed_days: int = Field(default=0, ge=0)
    # Accepted for backwards compatibility; root target_recovery_months wins.
    target_months: Optional[int] = Field(default=None, ge=1, le=36)

    @property
    def monthly_operating_cost(self) -> float:
        return self.monthly_rent + self.maintenance_fee + self.other_fixed_cost


class StayMoveIn(BaseModel):
    business_name: str = "우리 매장"
    industry: str = "커피-음료"
    industry_code: str = "CS100010"
    current_operating_status: str = "영업 중"
    current: CurrentStoreIn
    candidates: List[CandidateIn] = Field(..., min_length=1, max_length=3)
    target_recovery_months: Optional[int] = Field(default=None, ge=1, le=36)
    # Legacy field is intentionally ignored; kept only so old demo requests do not 422.
    can_continue_current: Optional[bool] = None


class PolicySummaryItem(BaseModel):
    policy_name: str = ""
    region_slot: str = ""
    why_relevant: str = ""
    key_condition: str = ""
    caution: str = ""
    source_url: str = ""


class FinancialSummary(BaseModel):
    additional_fund_needed: str = ""
    required_retention: str = ""
    summary: str = ""


class CandidateExplanation(BaseModel):
    candidate_id: str = ""
    candidate_region: str = ""
    financial_summary: FinancialSummary = Field(default_factory=FinancialSummary)
    policy_summary: List[PolicySummaryItem] = Field(default_factory=list)
    candidate_interpretation: str = ""
    important_checks: List[str] = Field(default_factory=list)
    one_line_summary: str = ""
    strengths: List[str] = Field(default_factory=list)
    risks: List[str] = Field(default_factory=list)
    decision_condition: str = ""


class OverallExplanation(BaseModel):
    headline: str = ""
    reason: str = ""
    main_risk: str = ""


class BatchExplanation(BaseModel):
    candidates: List[CandidateExplanation] = Field(default_factory=list)
    comparison_text: str = ""
    overall: OverallExplanation = Field(default_factory=OverallExplanation)


def _fund_use_tags(*, interior_cost: float, additional_fund_needed: float) -> set:
    """Derive which fund_use categories the candidate's own costs actually justify —
    only used to prioritize policies whose own fund_use text already matches; never
    used to claim eligibility for a use a policy doesn't itself mention."""
    tags = set()
    if interior_cost and interior_cost > 0:
        tags.add("facility")
    if additional_fund_needed and additional_fund_needed > 0:
        tags.add("working_capital")
    return tags


def _policy_search(*, industry: str, district: Optional[str], fund_manwon: float, low_priority: bool,
                   analysis_mode: str, operating_status: str, fund_use_tags: Optional[set] = None,
                   topk: int = 3) -> tuple[dict, float]:
    start = time.perf_counter()
    empty = {"status": "region_unknown", "message": "후보지 주소에서 서울 자치구를 확인할 수 없어 정책자금 검색을 실행하지 않았습니다.",
              "query": None, "results": [], "historical": [], "fund_priority": "low" if low_priority else "normal"}
    if not district:
        return empty, time.perf_counter() - start
    try:
        from policy_rag.src.retrieve import compact_result, retrieve
        query, rows, historical_rows = retrieve(
            industry=industry,
            region=district,
            fund=int(round(fund_manwon * 10_000)),
            topk=topk,
            relocation_type=("성장·기회 관점" if analysis_mode == "growth_opportunity" else "비용·회복 관점"),
            operating_status=operating_status,
            priority_note=("현재 자기자금으로 초기비용 충당 가능. 시설/운전자금·자기자금 보존 목적으로 참고." if low_priority else None),
            fund_use_tags=fund_use_tags,
        )
        results = [compact_result(row) for row in rows]
        historical = [compact_result(row) for row in historical_rows]
        if low_priority:
            message = "필수 자금조달 필요성은 낮지만, 자기자금 보존 또는 시설·운전자금 측면에서 참고할 수 있습니다." if results else "현재 조건에서 확인된 정책금융이 없습니다."
        else:
            message = "검색된 정책은 실제 승인 또는 지원 확정을 의미하지 않습니다." if results else "현재 조건에서 확인된 정책금융이 없습니다."
        out = {
            "status": "ok",
            "message": message,
            "query": query,
            "results": results,
            "historical": historical,
            "fund_priority": "low" if low_priority else "normal",
        }
        return out, time.perf_counter() - start
    except Exception:
        logger.exception("정책자금 RAG 검색 실패")
        return ({**empty, "status": "error", "message": "정책 데이터를 불러오지 못했습니다."}, time.perf_counter() - start)


def _ml_predict(*, c: CandidateIn, district: Optional[str], industry: str, industry_code: str) -> tuple[dict, float]:
    """Returns {"ml": {...}, "market_observed": {...}} in every branch so the caller
    can always unpack both keys uniformly regardless of success/error/disabled."""
    start = time.perf_counter()
    try:
        from ml.runtime import predict_candidate
        result = predict_candidate(trdar_cd=c.trdar_cd, district=district, industry=industry, industry_code=industry_code)
        return result, time.perf_counter() - start
    except Exception as exc:
        logger.exception("ML 추론 실패")
        return (
            {"ml": {"status": "error", "message": str(exc)[:200]}, "market_observed": {"status": "error"}},
            time.perf_counter() - start,
        )


def analyze(payload: dict, use_rag: bool = True, use_ml: bool = True) -> dict:
    started = time.perf_counter()
    data = StayMoveIn(**payload)
    if data.current.monthly_sales <= 0:
        raise ValueError("현재 월평균 매출은 0보다 커야 합니다.")
    if data.current.variable_cost < 0 or data.current.fixed_cost < 0:
        raise ValueError("현재 매장의 비용은 0 이상이어야 합니다.")

    cur = CurrentStore(
        monthly_sales=data.current.monthly_sales,
        variable_cost=data.current.variable_cost,
        fixed_cost=data.current.fixed_cost,
        deposit=data.current.deposit,
    )

    analyses = []
    rag_seconds = 0.0
    ml_seconds = 0.0
    has_cost_recovery = False

    for c in data.candidates:
        analysis_mode = "growth_opportunity" if c.monthly_operating_cost > data.current.fixed_cost else "cost_recovery"
        has_cost_recovery = has_cost_recovery or analysis_mode == "cost_recovery"
        recovery_months = data.target_recovery_months or c.target_months or 24

        cand = CandidateStore(
            name=c.name,
            monthly_rent=c.monthly_rent,
            maintenance_fee=c.maintenance_fee,
            other_fixed_cost=c.other_fixed_cost,
            deposit=c.deposit,
            interior_cost=c.interior_cost,
            moving_cost=c.moving_cost,
            restoration_cost=c.restoration_cost,
            rights_fee=c.rights_fee,
            other_moving_cost=c.other_moving_cost,
            closed_days=c.closed_days,
        )
        # Include exact slider month in deterministic Rule Engine target calculation.
        target_periods = sorted(set([12, 24, 36, recovery_months]))
        res = compute(cur, cand, target_periods=target_periods)

        additional_fund_needed = max(0.0, res.initial_relocation_capital - data.current.self_fund)
        district = extract_district(c.name)

        # ML (lightgbm/sklearn) is loaded before RAG (torch/faiss/sentence-transformers) —
        # loading them in the opposite order in a fresh process crashes native OpenMP/BLAS
        # init on this stack. The FastAPI startup warmup already loads them in this same
        # safe order; this keeps ad-hoc/CLI runs (no warmup) safe too.
        ml_result, msec = (_ml_predict(c=c, district=district, industry=data.industry,
                                       industry_code=data.industry_code)
                           if use_ml else ({"ml": {"status": "disabled"}, "market_observed": {"status": "disabled"}}, 0.0))
        ml_seconds += msec

        policy_rag, rsec = (_policy_search(
            industry=data.industry,
            district=district,
            fund_manwon=additional_fund_needed if additional_fund_needed > 0 else res.initial_relocation_capital,
            low_priority=additional_fund_needed <= 0,
            analysis_mode=analysis_mode,
            operating_status=data.current_operating_status,
            fund_use_tags=_fund_use_tags(interior_cost=c.interior_cost, additional_fund_needed=additional_fund_needed),
        ) if use_rag else ({"status": "disabled", "message": "RAG 비활성화", "query": None, "results": [], "historical": []}, 0.0))
        rag_seconds += rsec

        target_periods_out = []
        for months, required_sales in sorted(res.target_period_required_sales.items()):
            target_periods_out.append({
                "months": months,
                "required_sales": round(required_sales),
                "required_retention": round(required_sales / cur.monthly_sales, 4),
                "selected": analysis_mode == "cost_recovery" and months == recovery_months,
            })

        analyses.append({
            "site_id": c.site_id,
            "name": c.name,
            "trdar_cd": c.trdar_cd,
            "candidate_region": district,
            "analysis_mode": analysis_mode,
            "monthly_operating_cost": round(c.monthly_operating_cost),
            "monthly_cost_delta": round(c.monthly_operating_cost - data.current.fixed_cost),
            "min_required_sales": round(res.min_required_sales),
            "required_retention": round(res.required_retention, 4),
            "initial_capital": round(res.initial_relocation_capital),
            "available_self_fund": round(data.current.self_fund),
            "available_cash": round(data.current.self_fund),
            "additional_fund_needed": round(additional_fund_needed),
            "additional_fund_needed_krw": int(round(additional_fund_needed * 10_000)),
            "net_deposit_change": round(res.net_deposit_change),
            "actual_relocation_cost": round(res.actual_relocation_cost),
            # 합계가 어떤 값들로 이뤄졌는지 화면에서 펼쳐 볼 수 있게 구성 항목을 함께 내려보낸다.
            # 휴업손실은 사용자가 직접 넣은 값이 아니라 휴업일수로 계산한 값이라 따로 담는다.
            "relocation_cost_items": [
                {"label": "인테리어", "amount": round(c.interior_cost)},
                {"label": "이사", "amount": round(c.moving_cost)},
                {"label": "원상복구", "amount": round(c.restoration_cost)},
                {"label": "권리금", "amount": round(c.rights_fee)},
                {"label": "기타", "amount": round(c.other_moving_cost)},
                {"label": f"휴업 {c.closed_days}일", "amount": round(res.actual_relocation_cost
                                                                    - c.interior_cost - c.moving_cost
                                                                    - c.restoration_cost - c.rights_fee
                                                                    - c.other_moving_cost)},
            ],
            "candidate_fixed_cost": round(res.candidate_fixed_cost),
            "operating_cost_items": [
                {"label": "월세", "amount": round(c.monthly_rent)},
                {"label": "관리비", "amount": round(c.maintenance_fee)},
                {"label": "기타 고정비", "amount": round(c.other_fixed_cost)},
            ],
            "target_months": recovery_months,
            "recovery_relevance": "primary" if analysis_mode == "cost_recovery" else "secondary",
            "target_periods": target_periods_out,
            "scenarios": [
                {
                    "retention": s.retention,
                    "candidate_sales": round(s.candidate_sales),
                    "monthly_gain": round(s.monthly_gain) if s.monthly_gain == s.monthly_gain else None,
                    "payback_months": round(s.payback_months, 1) if s.payback_months is not None else None,
                }
                for s in res.payback_scenarios
            ],
            "ml": ml_result.get("ml", ml_result),
            "market_observed": ml_result.get("market_observed", {"status": "unavailable"}),
            "policy_rag": policy_rag,
            "warnings": res.warnings,
        })

    return {
        "business_name": data.business_name,
        "industry": data.industry,
        "industry_code": data.industry_code,
        "comparison_mode": "CANDIDATE_COMPARISON",
        "decision_options": [f"MOVE_{c.site_id}" for c in data.candidates],
        "current_operating_status": data.current_operating_status,
        "business_age_months": data.current.business_age_months,
        "current_address": data.current.address,
        "current_operating_profit": round(cur.operating_profit),
        "current_monthly_sales": round(cur.monthly_sales),
        "current_monthly_fixed_cost": round(cur.fixed_cost),
        "current_available_self_fund": round(data.current.self_fund),
        "contribution_margin_rate": round(cur.contribution_margin_rate, 4),
        "target_recovery_months": data.target_recovery_months or 24,
        "needs_recovery_question": has_cost_recovery,
        "candidates": analyses,
        "ranking": rank_candidates(analyses),
        "performance": {
            "analysis_seconds": round(time.perf_counter() - started, 3),
            "rag_retrieval_seconds": round(rag_seconds, 3),
            "ml_inference_seconds": round(ml_seconds, 3),
            "llm_seconds": 0.0,
            "llm_calls": 0,
        },
        "assumptions": [
            "후보 매장에서도 현재 매장과 동일한 변동비율이 유지된다고 가정합니다.",
            "현재 보증금은 이전 시점에 회수해 후보 보증금에 재투입할 수 있다고 가정합니다.",
            "정책지원 후보가 검색되어도 지원금이 확보된 것으로 계산하지 않습니다.",
            "growth_opportunity / cost_recovery는 후보별 월 반복비용과 현재 월 고정비의 비교용 내부 분석모드이며 사용자에게 자발/비자발로 표시하지 않습니다.",
            "ML 결과는 원본 ML_branch 모델/데이터를 이용한 추정치이며 Rule Engine의 확정 계산값을 대체하지 않습니다.",
        ],
    }


_STATUS_NEEDS_NOTE = {"마감", "오늘 마감", "예산 소진 여부 확인 필요", "신청기간 확인 필요"}


def _deterministic_important_checks(candidate: dict) -> List[str]:
    checks = []
    for p in (candidate.get("policy_rag") or {}).get("results", []):
        name = p.get("name", "정책")
        if p.get("source_verification_needed"):
            checks.append(f"{name}: 공식 원공고 추가 확인 필요(출처 등급 C)")
        if p.get("eligibility_needs_check"):
            checks.append(f"{name}: {p.get('eligibility_note') or '자격 추가 확인 필요'}")
        status = p.get("application_status")
        if status in _STATUS_NEEDS_NOTE:
            checks.append(f"{name}: 신청상태 '{status}' — 접수 가능 여부 확인 필요")
    if candidate.get("additional_fund_needed", 0) > 0 and not (candidate.get("policy_rag") or {}).get("results"):
        checks.append("현재 조건에서 확인된 정책금융이 없어 추가 자금조달 방안을 별도로 확인해야 합니다.")
    return list(dict.fromkeys(checks))[:6]


def _candidate_fallback_paragraph(c: dict) -> str:
    base = (
        f"후보 {c['site_id']}는 현재 월 수익을 유지하려면 월 {c['min_required_sales']:,}만원, "
        f"현재 매출의 {c['required_retention']*100:.1f}%가 필요합니다. 초기 이전 소요자금은 "
        f"{c['initial_capital']:,}만원이고 자기자금 반영 후 추가 필요 이전자금은 {c['additional_fund_needed']:,}만원입니다."
    )
    ml = c.get("ml") or {}
    if ml.get("predicted_monthly_sales") is not None:
        base += f" ML 추정 정상 월매출은 {ml['predicted_monthly_sales']:,}만원입니다."
    return base


def _fallback_candidate_explanation(c: dict, failed: bool = False) -> dict:
    results = (c.get("policy_rag") or {}).get("results", [])
    return {
        "candidate_id": c["site_id"],
        "candidate_region": c.get("candidate_region") or "확인 필요",
        "financial_summary": {
            "additional_fund_needed": f"{c['additional_fund_needed']:,}만원",
            "required_retention": f"{c['required_retention']*100:.1f}%",
            "summary": _candidate_fallback_paragraph(c),
        },
        "policy_summary": [
            {
                "policy_name": p.get("name", ""), "region_slot": p.get("region_slot", ""),
                "why_relevant": "", "key_condition": p.get("amount_limit", ""),
                "caution": p.get("eligibility_note", ""), "source_url": p.get("url", ""),
            } for p in results[:3]
        ],
        "candidate_interpretation": "AI 설명을 생성하지 못해 계산·검색 결과만 표시합니다." if failed else _candidate_fallback_paragraph(c),
        "important_checks": _deterministic_important_checks(c),
        "one_line_summary": "계산·검색 결과만 표시합니다." if failed else "AI 해석이 비활성화되어 계산·검색 결과만 표시합니다.",
        "strengths": [],
        "risks": [],
        "decision_condition": "",
        "mode": "error_fallback" if failed else "disabled",
    }


def _policy_context_block(c: dict) -> str:
    results = (c.get("policy_rag") or {}).get("results", [])
    if not results:
        return "- 검색된 정책금융 없음"
    blocks = []
    for i, p in enumerate(results[:3], 1):
        blocks.append(
            f"[{i}] {p.get('name','')} | 지역={p.get('region_slot','')} | 지원유형={p.get('support_type','')} | "
            f"한도={p.get('amount_limit','')} | 금리={p.get('interest_rate','')} | 업력={p.get('business_age_requirement','')} | "
            f"신청상태={p.get('application_status','')} | 출처등급={p.get('source_grade') or '확인불가'} | URL={p.get('url','')}"
        )
    return "\n".join(blocks)


def _candidate_context(facts: dict, c: dict) -> str:
    ml = c.get("ml") or {}
    observed = c.get("market_observed") or {}
    mode_label = "추가 비용을 감수할 가치/성장 가능성" if c["analysis_mode"] == "growth_opportunity" else "비용 절감/회복 가능성"
    lines = [
        f"후보 ID={c['site_id']}, 지역={c.get('candidate_region') or '확인 필요'}, 주소={c['name']}",
        f"analysis_mode={c['analysis_mode']} ({mode_label})",
        f"현재 월 고정비={facts['current_monthly_fixed_cost']:,}만원, 후보 월 반복비용={c['monthly_operating_cost']:,}만원, 차이={c['monthly_cost_delta']:+,}만원",
        f"최소 필요 월매출={c['min_required_sales']:,}만원, 필요 매출 유지율={c['required_retention']*100:.1f}%",
        f"초기 이전 소요자금={c['initial_capital']:,}만원, 추가 필요 이전자금={c['additional_fund_needed']:,}만원",
    ]
    if c["analysis_mode"] == "cost_recovery" and c.get("target_months"):
        target = next((t for t in c["target_periods"] if t["months"] == c["target_months"]), None)
        if target:
            lines.append(f"목표 회수기간={c['target_months']}개월, 해당 기간 필요 월매출={target['required_sales']:,}만원")
    if ml.get("predicted_monthly_sales") is not None:
        source_note = "서울시 실제 상권 데이터 기반 모델(model_source=real)" if ml.get("model_source") == "real" else "합성 데이터 fallback 모델(신뢰 낮음)"
        lines.append(
            f"ML 예상 동종업종 점포당 월매출(모델 추정치, {source_note})={ml['predicted_monthly_sales']:,}만원, "
            f"data_completeness={ml.get('data_completeness')}"
        )
    if observed.get("status") == "ok":
        lines.append(
            "실제 관측 상권지표(모델 추정 아님, 실측값)="
            f"폐업률 {observed.get('close_rate')}%, 개업률 {observed.get('open_rate')}%, "
            f"전년동기매출YoY {observed.get('sales_yoy')}%, 평균영업기간 {observed.get('avg_open_months')}개월, "
            f"매출추세 {observed.get('sales_trend')}"
        )
    fund_priority = (c.get("policy_rag") or {}).get("fund_priority")
    if fund_priority == "low":
        lines.append("정책자금 우선도=낮음 (자기자금으로 초기비용 충당 가능, 시설/운전자금 참고용)")
    lines.append("정책 RAG:\n" + _policy_context_block(c))
    checks = _deterministic_important_checks(c)
    lines.append("반드시 반영할 확인사항: " + ("; ".join(checks) if checks else "없음"))
    ranking = facts.get("ranking") or {}
    reason = (ranking.get("reasons") or {}).get(c["site_id"], {})
    lines.append(
        f"[결정된 순위 근거 — 재판단 금지] 전체 순위={ranking.get('ranking')}, "
        f"추천={ranking.get('recommended_candidate')}, 신뢰도={ranking.get('confidence')}, "
        f"이 후보 사업성 충족={reason.get('viable')}, 목표회수기간 충족={reason.get('meets_recovery_target')}, "
        f"매출여유율={reason.get('sales_buffer_ratio')}, 매출여유율 순위={reason.get('sales_buffer_rank')}위 "
        "(순위는 매출여유율 하나만으로 정렬한 값이며, 동률일 때만 추가필요자금·ML안정성·정책활용도 순으로 tie-break함)"
    )
    return "\n".join(lines)


def _normalize_policy_name(name: str) -> str:
    return re.sub(r"\s+", "", name or "")


def _reconcile_policy_summary(items: List[PolicySummaryItem], results: List[dict]) -> List[dict]:
    by_name = {_normalize_policy_name(r.get("name", "")): r for r in results}
    reconciled = []
    for item in items:
        match = by_name.get(_normalize_policy_name(item.policy_name))
        if not match:
            match = next((r for r in results if item.policy_name and (item.policy_name in r.get("name", "") or r.get("name", "") in item.policy_name)), None)
        if not match:
            continue
        reconciled.append({
            "policy_name": match.get("name", ""), "region_slot": match.get("region_slot", ""),
            "why_relevant": item.why_relevant, "key_condition": item.key_condition,
            "caution": item.caution, "source_url": match.get("url", ""),
        })
    return reconciled


def _generate_batch_explanation(facts: dict) -> tuple[dict, float]:
    """One LLM call for A/B/C, instead of candidate-by-candidate + comparison calls."""
    started = time.perf_counter()
    from crewai import LLM, Agent, Crew, Process, Task

    contexts = "\n\n===== 후보 구분 =====\n\n".join(_candidate_context(facts, c) for c in facts["candidates"])
    ranking = facts.get("ranking") or {}
    agent = Agent(
        role="매장 이전 경제성 설명가",
        goal="Rule Engine, ML 추정, 검색된 정책 RAG 근거, 그리고 이미 결정된 후보 순위만 사용해 숫자 사이의 관계를 설명한다.",
        backstory=(
            "숫자와 공공정책 근거를 사장님의 언어로 번역한다. 계산값을 수정하지 않고, 검색되지 않은 정책을 만들지 않는다. "
            "지원 가능성이나 이전 추천을 확정하지 않는다. 자발/비자발이라는 표현을 사용하지 않는다. "
            "이미 계산된 후보 순위를 재판단하거나 뒤집지 않는다 — 그 순서가 왜 나왔는지만 숫자로 설명한다."
        ),
        llm=LLM(model=os.getenv("OPENAI_MODEL_NAME", "gpt-4o-mini"), temperature=0.2),
        verbose=False,
    )
    description = f"""
아래 후보 A/B/C 데이터는 이미 계산·검색이 끝난 근거이며, 순위도 이미 결정되어 있습니다.

전체 순위(변경 불가)={ranking.get('ranking')}, 추천 후보(변경 불가)={ranking.get('recommended_candidate')}, 신뢰도={ranking.get('confidence')}

{contexts}

작성 규칙:
1) candidates 배열에 실제 후보 수만큼 정확히 작성하고 candidate_id를 그대로 유지한다.
2) financial_summary의 additional_fund_needed와 required_retention은 위 숫자를 그대로 옮긴다.
3) policy_summary는 해당 후보의 '정책 RAG'에 나온 정책만 최대 3개 사용한다. 없는 정책/금리/한도/조건을 만들지 않는다.
4) growth_opportunity는 '현재보다 반복비용을 더 부담할 만큼 성장 가능성이 있는지' 관점으로 설명한다.
5) cost_recovery는 '비용 구조 안정과 이전비 회수 가능성' 관점으로 설명한다.
6) ML(예상 동종업종 점포당 월매출)은 모델 추정치라고 명시하며 Rule Engine 확정값과 섞어 재계산하지 않는다.
6-1) "실제 관측 상권지표"(폐업률/개업률/YoY/평균영업기간/매출추세)는 모델 예측이 아니라 실측값이다. 이 둘을 절대 혼동하거나 같은 것처럼 쓰지 않는다.
6-2) "폐업확률"이라는 표현을 쓰지 않는다. 실제 관측 폐업률을 말할 때는 "실측 폐업률"이라고 명확히 쓴다.
7) '지원받을 수 있다/신청 가능하다/전액 충당된다' 같은 확정 표현 금지. 자격·출처·신청상태 불명확 시 확인 필요라고 쓴다.
8) 자발/비자발, STAY_VS_MOVE, MOVE_VS_MOVE 표현 금지.
9) 위에 주어진 전체 순위/추천 후보를 그대로 받아들이고 재판단하지 않는다. 다른 후보를 추천하거나 순서를 암시적으로 바꾸는 문장을 쓰지 않는다.
10) 각 후보는 "숫자를 다시 읽어주는 문장"이 아니라 "숫자 사이의 관계"를 설명한다 (예: 예상매출이 최소필요매출을 얼마나/몇 % 상회하는지, 그 여유폭이 위험한 수준인지).
11) one_line_summary는 해당 후보를 한 문장으로 압축한 결론. strengths/risks는 각각 1~3개, 반드시 구체적 수치를 포함한다. decision_condition은 "이 후보를 선택하려면 무엇이 유지/충족돼야 하는가"를 구체적으로 쓴다.
12) important_checks는 정책 eligibility/신청상태가 불확실할 때만 채우고, 확정된 사실을 재확인 필요라고 쓰지 않는다.
13) overall.headline은 결론 한 문장, overall.reason은 왜 그 순위인지 숫자 근거 포함 2~3문장, overall.main_risk는 추천 후보의 가장 큰 리스크 1개(장점만 말하지 않는다).
14) comparison_text는 순위를 다시 설명하지 말고, 후보 간 실제 수치 차이(최소 2개 이상)를 근거로 3~5문장으로 설명한다.
"""
    task = Task(
        description=description,
        expected_output="후보별 구조화 설명(one_line_summary/strengths/risks/decision_condition 포함)과 overall 요약, 순위를 재판단하지 않는 comparison_text",
        agent=agent,
        output_pydantic=BatchExplanation,
    )
    output = Crew(agents=[agent], tasks=[task], process=Process.sequential, verbose=False).kickoff()
    parsed = getattr(output, "pydantic", None)
    if not isinstance(parsed, BatchExplanation):
        raise RuntimeError("구조화된 통합 설명을 받지 못했습니다.")

    by_id = {x.candidate_id: x for x in parsed.candidates}
    explanations = {}
    for c in facts["candidates"]:
        p = by_id.get(c["site_id"])
        if not p:
            explanations[c["site_id"]] = _fallback_candidate_explanation(c, failed=True)
            continue
        checks = list(_deterministic_important_checks(c))
        for chk in p.important_checks:
            if chk not in checks:
                checks.append(chk)
        explanations[c["site_id"]] = {
            "candidate_id": c["site_id"],
            "candidate_region": c.get("candidate_region") or "확인 필요",
            "financial_summary": {
                "additional_fund_needed": f"{c['additional_fund_needed']:,}만원",
                "required_retention": f"{c['required_retention']*100:.1f}%",
                "summary": p.financial_summary.summary,
            },
            "policy_summary": _reconcile_policy_summary(p.policy_summary, (c.get("policy_rag") or {}).get("results", [])),
            "candidate_interpretation": p.candidate_interpretation,
            "important_checks": checks[:8],
            "one_line_summary": p.one_line_summary,
            "strengths": p.strengths[:3],
            "risks": p.risks[:3],
            "decision_condition": p.decision_condition,
            "mode": "llm",
        }
    # ranking/recommended_candidate are never read from the LLM output — BatchExplanation's
    # schema has no such field, so this is enforced by construction, not a post-hoc filter.
    overall = {
        "headline": parsed.overall.headline,
        "reason": parsed.overall.reason,
        "main_risk": parsed.overall.main_risk,
        "ranking": ranking.get("ranking"),
        "recommended_candidate": ranking.get("recommended_candidate"),
        "confidence": ranking.get("confidence"),
    }
    performance_extra = {"prompt_chars": len(description)}
    return {
        "explanations": explanations,
        "comparison_text": parsed.comparison_text,
        "overall": overall,
        "performance_extra": performance_extra,
    }, time.perf_counter() - started


def explain_facts(facts: dict) -> tuple[dict, float]:
    """AI 설명 단계만 실행한다 — Rule/ML/RAG 계산(analyze())과 분리되어 있어

    /staymove(explain=true)와 /staymove/explain(2단계 호출) 양쪽에서 재사용된다.
    반환 shape은 항상 {explanations, comparison_text, overall, performance_extra, explain_mode, explain_error?}
    로 통일해 호출부가 LLM 성공/비활성/실패를 분기 없이 동일하게 다룰 수 있게 한다.
    """
    ranking = facts.get("ranking") or {}
    fallback_overall = {
        "headline": "", "reason": "", "main_risk": "",
        "ranking": ranking.get("ranking"), "recommended_candidate": ranking.get("recommended_candidate"),
        "confidence": ranking.get("confidence"),
    }
    enable_llm = os.getenv("ENABLE_LLM_EXPLANATION", "true").strip().lower() != "false"
    has_key = bool(os.getenv("OPENAI_API_KEY"))
    if not enable_llm or not has_key:
        explanations = {c["site_id"]: _fallback_candidate_explanation(c) for c in facts["candidates"]}
        return {
            "explanations": explanations, "comparison_text": None, "overall": fallback_overall,
            "performance_extra": {}, "explain_mode": "disabled",
        }, 0.0

    try:
        batch, llm_seconds = _generate_batch_explanation(facts)
        batch["explain_mode"] = "llm_single_call"
        return batch, llm_seconds
    except Exception as exc:
        logger.exception("통합 AI 설명 생성 실패")
        explanations = {c["site_id"]: _fallback_candidate_explanation(c, failed=True) for c in facts["candidates"]}
        return {
            "explanations": explanations, "comparison_text": None, "overall": fallback_overall,
            "performance_extra": {}, "explain_mode": "rule_ml_rag_fallback", "explain_error": str(exc)[:300],
        }, 0.0


def run(payload: dict, explain: bool = True, use_rag: bool = True, use_ml: bool = True) -> dict:
    total_started = time.perf_counter()
    facts = analyze(payload, use_rag=use_rag, use_ml=use_ml)
    if not explain:
        facts["performance"]["total_seconds"] = round(time.perf_counter() - total_started, 3)
        return facts

    batch, llm_seconds = explain_facts(facts)
    for c in facts["candidates"]:
        c["ai_explanation"] = batch["explanations"][c["site_id"]]
    facts["comparison_summary"] = batch["comparison_text"]
    facts["overall"] = batch["overall"]
    facts["explanation_markdown"] = "\n\n".join(c["ai_explanation"]["candidate_interpretation"] for c in facts["candidates"])
    facts["explain_mode"] = batch["explain_mode"]
    if "explain_error" in batch:
        facts["explain_error"] = batch["explain_error"]
    facts["performance"]["llm_seconds"] = round(llm_seconds, 3)
    facts["performance"]["llm_calls"] = 1 if batch["explain_mode"] == "llm_single_call" else 0
    facts["performance"].update(batch.get("performance_extra") or {})
    facts["performance"]["total_seconds"] = round(time.perf_counter() - total_started, 3)
    return facts


DEMO_PAYLOAD = {
    "business_name": "스테이 커피",
    "industry": "커피-음료",
    "industry_code": "CS100010",
    "current": {
        "address": "서울 마포구 양화로 33",
        "monthly_sales": 2800, "variable_cost": 1120, "fixed_cost": 930,
        "deposit": 2000, "available_self_fund": 1500, "business_age_months": 36,
    },
    "target_recovery_months": 24,
    "candidates": [
        {"site_id": "A", "name": "서울 마포구 망원로 50", "monthly_rent": 600, "maintenance_fee": 40, "other_fixed_cost": 400,
         "deposit": 3000, "interior_cost": 2500, "moving_cost": 500, "restoration_cost": 300, "rights_fee": 0, "other_moving_cost": 0, "closed_days": 15},
        {"site_id": "B", "name": "서울 마포구 월드컵로13길 18", "monthly_rent": 250, "maintenance_fee": 20, "other_fixed_cost": 300,
         "deposit": 2500, "interior_cost": 1700, "moving_cost": 450, "restoration_cost": 300, "rights_fee": 0, "other_moving_cost": 0, "closed_days": 10},
    ],
}

if __name__ == "__main__":
    import sys
    print(json.dumps(run(DEMO_PAYLOAD, explain="--explain" in sys.argv, use_rag="--no-rag" not in sys.argv), ensure_ascii=False, indent=2))
