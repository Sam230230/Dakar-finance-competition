"""
Stay or Move 오케스트레이터

최종 기획안 기준:
- 온보딩 질문: "현재 매장에서 계속 영업할 수 있나요?"
  YES -> 자발적 이전 (Stay vs Move)
  NO  -> 비자발적 이전 (Move vs Move)
- Rule Engine은 사용자 입력값만으로 계산한다.
- Rule Engine의 추가 필요 이전자금을 정책자금 RAG 검색 Context로 전달한다.
- RAG 결과는 지원 가능성을 확정하지 않고 "검토 가능한 정책 후보"만 반환한다.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import List, Optional

logger = logging.getLogger(__name__)

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

from pydantic import BaseModel, Field

from engine.rule_engine import CurrentStore, CandidateStore, compute

SEOUL_DISTRICTS = [
    "강남구", "강동구", "강북구", "강서구", "관악구",
    "광진구", "구로구", "금천구", "노원구", "도봉구",
    "동대문구", "동작구", "마포구", "서대문구", "서초구",
    "성동구", "성북구", "송파구", "양천구", "영등포구",
    "용산구", "은평구", "종로구", "중구", "중랑구",
]


def extract_district(text: str) -> Optional[str]:
    value = text or ""
    for district in SEOUL_DISTRICTS:
        if district in value:
            return district
    return None


class CurrentStoreIn(BaseModel):
    monthly_sales: float
    variable_cost: float
    fixed_cost: float
    deposit: float = 0.0
    available_cash: float = 0.0


class CandidateIn(BaseModel):
    site_id: str
    name: str
    monthly_rent: float
    maintenance_fee: float = 0.0
    other_fixed_cost: float = 0.0
    deposit: float = 0.0
    interior_cost: float = 0.0
    moving_cost: float = 0.0
    restoration_cost: float = 0.0
    rights_fee: float = 0.0
    other_moving_cost: float = 0.0
    closed_days: int = 0
    target_months: int = 24


class StayMoveIn(BaseModel):
    business_name: str = "우리 매장"
    industry: str = "카페"
    can_continue_current: bool = True
    current_operating_status: str = "영업 중"
    current: CurrentStoreIn
    candidates: List[CandidateIn] = Field(..., min_length=1, max_length=5)


# ── LLM Generation 출력 스키마 (후보 1곳 분량) ──
# Retrieval(근거 수집)과 Generation(설명) 역할을 분리하기 위해, LLM은 아래 구조만
# 채우고 정책명/금리/한도 등 사실 필드는 이후 _reconcile_policy_summary()에서
# 검색 결과로 강제 치환한다(LLM이 새 정책을 만들어내도 반영되지 않음).
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


class ComparisonSummary(BaseModel):
    comparison_text: str = ""


def _policy_search(
    *,
    industry: str,
    district: Optional[str],
    fund_manwon: float,
    relocation_type: str,
    operating_status: str,
    topk: int = 5,
) -> dict:
    if fund_manwon <= 0:
        return {
            "status": "not_needed",
            "message": "추가 필요 이전자금이 0원이므로 정책자금 검색을 우선 실행하지 않았습니다.",
            "query": None,
            "results": [],
        }
    if not district:
        return {
            "status": "region_unknown",
            "message": "후보지 주소에서 서울 자치구를 확인할 수 없어 정책자금 검색을 실행하지 않았습니다.",
            "query": None,
            "results": [],
        }

    fund_krw = int(round(fund_manwon * 10_000))
    try:
        from policy_rag.src.retrieve import compact_result, retrieve

        query, rows = retrieve(
            industry=industry,
            region=district,
            fund=fund_krw,
            topk=topk,
            relocation_type=relocation_type,
            operating_status=operating_status,
        )
        results = [compact_result(row) for row in rows]
        return {
            "status": "ok",
            "message": (
                "검색된 정책은 실제 승인 또는 지원 확정을 의미하지 않습니다."
                if results
                else "현재 조건에서 확인된 정책금융이 없습니다."
            ),
            "query": query,
            "results": results,
        }
    except Exception as exc:  # RAG 오류가 Rule Engine 전체를 막지 않게 분리
        # 화면에는 원인 문구를 그대로 노출하지 않고, 실제 예외는 서버 로그로만 남긴다.
        logger.exception("정책자금 RAG 검색 실패")
        return {
            "status": "error",
            "message": "정책 데이터를 불러오지 못했습니다.",
            "query": None,
            "results": [],
        }


def analyze(payload: dict, use_rag: bool = True) -> dict:
    """Rule Engine + 정책자금 RAG를 후보별로 계산한다."""
    data = StayMoveIn(**payload)

    if data.current.monthly_sales <= 0:
        raise ValueError("현재 월평균 매출은 0보다 커야 합니다.")
    if data.current.variable_cost < 0 or data.current.fixed_cost < 0:
        raise ValueError("현재 매장의 비용은 0 이상이어야 합니다.")

    relocation_type = "자발적" if data.can_continue_current else "비자발적"
    comparison_mode = "STAY_VS_MOVE" if data.can_continue_current else "MOVE_VS_MOVE"

    cur = CurrentStore(
        monthly_sales=data.current.monthly_sales,
        variable_cost=data.current.variable_cost,
        fixed_cost=data.current.fixed_cost,
        deposit=data.current.deposit,
    )

    analyses = []
    for c in data.candidates:
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
        res = compute(cur, cand)

        target_periods = []
        for months, required_sales in sorted(res.target_period_required_sales.items()):
            target_periods.append({
                "months": months,
                "required_sales": round(required_sales),
                "required_retention": round(required_sales / cur.monthly_sales, 4),
                "selected": months == c.target_months,
            })

        additional_fund_needed = max(
            0.0,
            res.initial_relocation_capital - data.current.available_cash,
        )
        district = extract_district(c.name)
        policy_rag = (
            _policy_search(
                industry=data.industry,
                district=district,
                fund_manwon=additional_fund_needed,
                relocation_type=relocation_type,
                operating_status=data.current_operating_status,
            )
            if use_rag
            else {"status": "disabled", "message": "RAG 비활성화", "query": None, "results": []}
        )

        analyses.append({
            "site_id": c.site_id,
            "name": c.name,
            "candidate_region": district,
            "min_required_sales": round(res.min_required_sales),
            "required_retention": round(res.required_retention, 4),
            "initial_capital": round(res.initial_relocation_capital),
            "available_cash": round(data.current.available_cash),
            "additional_fund_needed": round(additional_fund_needed),
            "additional_fund_needed_krw": int(round(additional_fund_needed * 10_000)),
            "net_deposit_change": round(res.net_deposit_change),
            "actual_relocation_cost": round(res.actual_relocation_cost),
            "candidate_fixed_cost": round(res.candidate_fixed_cost),
            "target_months": c.target_months,
            "target_periods": target_periods,
            "scenarios": [
                {
                    "retention": s.retention,
                    "candidate_sales": round(s.candidate_sales),
                    "monthly_gain": round(s.monthly_gain) if s.monthly_gain == s.monthly_gain else None,
                    "payback_months": round(s.payback_months, 1) if s.payback_months is not None else None,
                }
                for s in res.payback_scenarios
            ],
            "policy_rag": policy_rag,
            "warnings": res.warnings,
        })

    return {
        "business_name": data.business_name,
        "industry": data.industry,
        "can_continue_current": data.can_continue_current,
        "relocation_type": relocation_type,
        "comparison_mode": comparison_mode,
        "decision_options": (["STAY"] + [f"MOVE_{c.site_id}" for c in data.candidates]) if data.can_continue_current else [f"MOVE_{c.site_id}" for c in data.candidates],
        "current_operating_status": data.current_operating_status,
        "current_operating_profit": round(cur.operating_profit),
        "current_monthly_sales": round(cur.monthly_sales),
        "current_available_cash": round(data.current.available_cash),
        "contribution_margin_rate": round(cur.contribution_margin_rate, 4),
        "candidates": analyses,
        "assumptions": [
            "후보 매장에서도 현재 매장과 동일한 변동비율이 유지된다고 가정합니다.",
            "현재 보증금은 이전 시점에 회수해 후보 보증금에 재투입할 수 있다고 가정합니다.",
            "정책지원 후보가 검색되어도 지원금이 확보된 것으로 계산하지 않습니다.",
            "비자발적 이전에서는 현재 점포를 선택지로 두지 않고 기존 실적의 기준점으로만 사용합니다.",
        ],
    }


def _candidate_fallback_paragraph(c: dict) -> str:
    lines = [
        f"{c['site_id']}({c['name']})는 현재 월 수익을 유지하려면 월 "
        f"{c['min_required_sales']:,}만원, 현재 매출의 {c['required_retention']*100:.1f}%가 필요합니다. "
        f"초기 이전 소요자금은 {c['initial_capital']:,}만원이고, 보유 가용현금을 반영한 "
        f"추가 필요 이전자금은 {c['additional_fund_needed']:,}만원입니다."
    ]
    policies = c.get("policy_rag", {}).get("results", [])
    if policies:
        lines.append(
            f"{c.get('candidate_region') or '후보지역'} 기준으로 검토 가능한 정책금융 후보 {len(policies)}건이 검색되었습니다. "
            "실제 지원 가능 여부는 각 기관의 심사가 필요합니다."
        )
    return " ".join(lines)


def _fallback_explanation(facts: dict) -> str:
    lines = []
    if facts["comparison_mode"] == "STAY_VS_MOVE":
        lines.append("현재 매장을 유지할 수 있는 자발적 이전 상황으로, 현재 점포 Stay와 각 후보지 Move를 비교합니다.")
    else:
        lines.append("현재 매장을 유지하기 어려운 비자발적 이전 상황으로, 현재 점포는 기준점으로만 두고 후보지끼리 비교합니다.")
    for c in facts["candidates"]:
        lines.append(_candidate_fallback_paragraph(c))
    return "\n\n".join(lines)


# 사용자 재무 입력만으로는 검증할 수 없는 확인사항을 결정론적으로(=LLM 없이) 뽑아둔다.
# LLM 결과의 important_checks에 이 목록을 항상 우선 병합해, 자격/출처/신청상태 경고가
# 모델이 빠뜨리거나 지어내는 것과 무관하게 항상 노출되도록 한다.
_STATUS_NEEDS_NOTE = {"마감", "오늘 마감", "예산 소진 여부 확인 필요", "신청기간 확인 필요"}


def _deterministic_important_checks(candidate: dict) -> List[str]:
    checks: List[str] = []
    results = (candidate.get("policy_rag") or {}).get("results", [])
    for p in results:
        name = p.get("name", "정책")
        if p.get("source_verification_needed"):
            checks.append(f"{name}: 공식 원공고 추가 확인 필요(출처 등급 C)")
        if p.get("eligibility_needs_check"):
            checks.append(f"{name}: {p.get('eligibility_note') or '자격 추가 확인 필요'}")
        status = p.get("application_status")
        if status in _STATUS_NEEDS_NOTE:
            checks.append(f"{name}: 신청상태 '{status}' — 접수 가능 여부 확인 필요")
    if candidate.get("additional_fund_needed", 0) > 0 and not results:
        checks.append("현재 조건에서 확인된 정책금융이 없어 추가 자금조달 방안을 별도로 확인해야 합니다.")
    seen: set = set()
    ordered: List[str] = []
    for item in checks:
        if item not in seen:
            seen.add(item)
            ordered.append(item)
    return ordered[:6]


def _fallback_candidate_explanation(candidate: dict, failed: bool = False) -> dict:
    results = (candidate.get("policy_rag") or {}).get("results", [])
    return {
        "candidate_id": candidate["site_id"],
        "candidate_region": candidate.get("candidate_region") or "확인 필요",
        "financial_summary": {
            "additional_fund_needed": f"{candidate['additional_fund_needed']:,}만원",
            "required_retention": f"{candidate['required_retention'] * 100:.1f}%",
            "summary": _candidate_fallback_paragraph(candidate),
        },
        "policy_summary": [
            {
                "policy_name": p.get("name", ""),
                "region_slot": p.get("region_slot", ""),
                "why_relevant": "",
                "key_condition": p.get("amount_limit", ""),
                "caution": p.get("eligibility_note", ""),
                "source_url": p.get("url", ""),
            }
            for p in results[:5]
        ],
        "candidate_interpretation": (
            "AI 설명을 생성하지 못했습니다. 검색된 정책정보를 직접 확인해주세요."
            if failed
            else _candidate_fallback_paragraph(candidate)
        ),
        "important_checks": _deterministic_important_checks(candidate),
        "mode": "error_fallback" if failed else "disabled",
    }


def _rule_engine_block(facts: dict, candidate: dict) -> str:
    lines = [
        f"후보 ID: {candidate['site_id']}",
        f"후보 지역: {candidate.get('candidate_region') or '확인 필요'}",
        f"후보지 이름/주소: {candidate['name']}",
        f"현재 월평균 매출: {facts['current_monthly_sales']:,}만원",
        f"현재 월 영업이익: {facts['current_operating_profit']:,}만원",
        f"최소 필요 월매출(현재 이익 유지 기준): {candidate['min_required_sales']:,}만원",
        f"필요 매출 유지율: {candidate['required_retention'] * 100:.1f}%",
        f"초기 이전 소요자금: {candidate['initial_capital']:,}만원",
        f"보유 가용현금: {candidate['available_cash']:,}만원",
        f"추가 필요 이전자금: {candidate['additional_fund_needed']:,}만원",
        f"목표 회수기간: {candidate['target_months']}개월",
    ]
    target = next(
        (t for t in candidate.get("target_periods", []) if t["months"] == candidate["target_months"]),
        None,
    )
    if target:
        lines.append(
            f"{target['months']}개월 회수 목표 필요 매출: {target['required_sales']:,}만원 "
            f"(매출 유지율 {target['required_retention'] * 100:.1f}%)"
        )
    scenario95 = next(
        (s for s in candidate.get("scenarios", []) if round(s["retention"] * 100) == 95),
        None,
    )
    if scenario95:
        payback = scenario95.get("payback_months")
        lines.append(f"매출 95% 유지 시 회수기간: {f'{payback}개월' if payback is not None else '회수 어려움'}")
    return "\n".join(f"- {line}" for line in lines)


def _policy_context_block(candidate: dict) -> str:
    rag = candidate.get("policy_rag") or {}
    results = rag.get("results", [])
    if not results:
        return f"- 검색된 정책금융 없음 (status={rag.get('status')}, message={rag.get('message')})"
    blocks = []
    for i, p in enumerate(results[:5], 1):
        evidence = (p.get("evidence") or "")[:300]
        blocks.append(
            f"[{i}] {p.get('name', '')}\n"
            f"    지역슬롯={p.get('region_slot', '')} | 기관={p.get('agency', '')}\n"
            f"    지원유형={p.get('support_type', '')} | 자금용도={p.get('fund_use', '')}\n"
            f"    지원한도={p.get('amount_limit', '')} | 금리={p.get('interest_rate', '')}\n"
            f"    업력요건={p.get('business_age_requirement', '')} | 신청기간={p.get('application_period', '')}\n"
            f"    신청상태={p.get('application_status', '')}\n"
            f"    자격추가확인={'예' if p.get('eligibility_needs_check') else '아니오'} ({p.get('eligibility_note', '')})\n"
            f"    출처등급={p.get('source_grade') or '확인불가'} | 출처확인필요={'예' if p.get('source_verification_needed') else '아니오'}\n"
            f"    공식링크={p.get('url', '')}\n"
            f"    근거텍스트: {evidence}"
        )
    return "\n".join(blocks)


def _narrative_stance(comparison_mode: str) -> str:
    if comparison_mode == "STAY_VS_MOVE":
        return (
            "현재 매장을 유지하는 선택지와 이 후보로 이전하는 선택지를 비교하는 관점으로 설명하되, "
            "Stay 또는 Move 중 하나를 추천하지 말 것."
        )
    return (
        "현재 매장은 선택지가 아니라 과거 실적 기준점이므로, 이 후보가 다른 이전 후보들과 비교했을 때 "
        "재무 부담과 정책 활용 조건이 어떤지 설명할 것. 현재 매장 유지를 대안으로 제시하지 말 것."
    )


def _comparison_context(comparison_mode: str) -> str:
    if comparison_mode == "STAY_VS_MOVE":
        return "현재 매장을 유지할 수 있는 자발적 이전 상황이며, 이 후보는 현재 매장 대비 이전 옵션 중 하나입니다."
    return (
        "현재 매장을 유지하기 어려운 비자발적 이전 상황이며, 현재 매장은 기준점으로만 사용되고 "
        "이 후보는 다른 이전 후보들과 비교됩니다."
    )


def _normalize_policy_name(name: str) -> str:
    return re.sub(r"\s+", "", name or "")


def _reconcile_policy_summary(items: List[PolicySummaryItem], results: List[dict]) -> List[dict]:
    """LLM이 반환한 policy_summary를 검색 결과와 대조해, 실제 검색되지 않은
    정책(=환각)은 버리고 지역슬롯/공식링크는 검색 결과 값으로 강제 치환한다."""
    by_name = {_normalize_policy_name(r.get("name", "")): r for r in results}
    reconciled = []
    for item in items:
        match = by_name.get(_normalize_policy_name(item.policy_name))
        if not match:
            match = next(
                (
                    r
                    for r in results
                    if item.policy_name and (item.policy_name in r.get("name", "") or r.get("name", "") in item.policy_name)
                ),
                None,
            )
        if not match:
            logger.warning("LLM이 검색되지 않은 정책명을 생성해 제외함: %s", item.policy_name)
            continue
        reconciled.append({
            "policy_name": match.get("name", ""),
            "region_slot": match.get("region_slot", ""),
            "why_relevant": item.why_relevant,
            "key_condition": item.key_condition,
            "caution": item.caution,
            "source_url": match.get("url", ""),
        })
    return reconciled


def _build_llm(temperature: float = 0.2):
    from crewai import LLM

    return LLM(model=os.getenv("OPENAI_MODEL_NAME", "gpt-4o-mini"), temperature=temperature)


def _generate_candidate_explanations(facts: dict) -> dict:
    """후보마다 별도의 LLM 호출로 근거 기반 설명을 생성한다(facts 전체를 한 번에
    넣지 않음 — 후보 Context 분리가 이번 작업의 핵심 요구사항)."""
    from crewai import Agent, Crew, Process, Task
    from crewai.project import CrewBase, agent, crew, task

    llm = _build_llm()

    @CrewBase
    class StayMoveExplainerCrew:
        agents_config = "config/staymove_agents.yaml"
        tasks_config = "config/staymove_tasks.yaml"

        @agent
        def explainer(self) -> Agent:
            return Agent(config=self.agents_config["explainer"], llm=llm, verbose=False)

        @task
        def explain_task(self) -> Task:
            return Task(config=self.tasks_config["explain_task"], output_pydantic=CandidateExplanation)

        # 이름을 'crew'로 두면 함수-로컬 import(`from crewai.project import ... crew`)가
        # 클래스 본문 안에서 이 메서드 이름에 가려져 NameError가 난다(클로저가 아니라
        # 클래스 스코프의 지역 이름으로 취급됨). @crew는 메서드 이름을 요구하지 않으므로
        # build_crew로 이름을 바꿔 충돌을 피한다.
        @crew
        def build_crew(self) -> Crew:
            return Crew(agents=self.agents, tasks=self.tasks, process=Process.sequential, verbose=False)

    candidates = facts["candidates"]
    inputs_list = [
        {
            "candidate_id": c["site_id"],
            "candidate_region": c.get("candidate_region") or "확인 필요",
            "business_name": facts["business_name"],
            "industry": facts["industry"],
            "relocation_type": facts["relocation_type"],
            "comparison_context": _comparison_context(facts["comparison_mode"]),
            "narrative_stance": _narrative_stance(facts["comparison_mode"]),
            "rule_engine_block": _rule_engine_block(facts, c),
            "policy_context_block": _policy_context_block(c),
            "deterministic_checks_block": (
                "\n".join(f"- {x}" for x in _deterministic_important_checks(c)) or "- 없음"
            ),
        }
        for c in candidates
    ]

    outputs = StayMoveExplainerCrew().build_crew().kickoff_for_each(inputs=inputs_list)
    if len(outputs) != len(candidates):
        raise RuntimeError("후보 수와 생성된 설명 수가 일치하지 않습니다.")

    explanations = {}
    for c, output in zip(candidates, outputs):
        parsed = getattr(output, "pydantic", None)
        if not isinstance(parsed, CandidateExplanation):
            raise RuntimeError(f"후보 {c['site_id']} 설명을 구조화된 JSON으로 받지 못했습니다.")

        results = (c.get("policy_rag") or {}).get("results", [])
        reconciled_policies = _reconcile_policy_summary(parsed.policy_summary, results)

        merged_checks = list(_deterministic_important_checks(c))
        for chk in parsed.important_checks:
            if chk not in merged_checks:
                merged_checks.append(chk)

        explanations[c["site_id"]] = {
            "candidate_id": c["site_id"],
            "candidate_region": c.get("candidate_region") or "확인 필요",
            "financial_summary": {
                # Rule Engine 확정값은 LLM 출력이 아니라 여기서 다시 결정론적으로 채운다.
                "additional_fund_needed": f"{c['additional_fund_needed']:,}만원",
                "required_retention": f"{c['required_retention'] * 100:.1f}%",
                "summary": parsed.financial_summary.summary,
            },
            "policy_summary": reconciled_policies,
            "candidate_interpretation": parsed.candidate_interpretation,
            "important_checks": merged_checks[:8],
            "mode": "llm",
        }
    return explanations


def _generate_comparison_summary(facts: dict, explanations: dict) -> Optional[str]:
    """MOVE_VS_MOVE 후보 2곳 이상일 때만, 이미 생성된 후보별 요약을 근거로
    순위 없는 비교 문단을 하나 더 생성한다(새 정책 검색/추정 없음)."""
    if facts["comparison_mode"] != "MOVE_VS_MOVE" or len(facts["candidates"]) < 2:
        return None

    from crewai import Agent, Crew, Process, Task
    from crewai.project import CrewBase, agent, crew, task

    llm = _build_llm()

    lines = []
    for c in facts["candidates"]:
        exp = explanations.get(c["site_id"])
        if not exp:
            continue
        top_policy = exp["policy_summary"][0]["policy_name"] if exp["policy_summary"] else "확인된 정책 없음"
        checks = "; ".join(exp["important_checks"][:2]) or "없음"
        lines.append(
            f"- 후보 {c['site_id']}({exp['candidate_region']}): "
            f"추가 필요 이전자금 {exp['financial_summary']['additional_fund_needed']}, "
            f"필요 매출 유지율 {exp['financial_summary']['required_retention']}, "
            f"주요 정책 '{top_policy}', 확인사항 {checks}"
        )
    if not lines:
        return None

    @CrewBase
    class ComparisonCrew:
        agents_config = "config/staymove_agents.yaml"
        tasks_config = "config/staymove_tasks.yaml"

        @agent
        def explainer(self) -> Agent:
            return Agent(config=self.agents_config["explainer"], llm=llm, verbose=False)

        @task
        def comparison_task(self) -> Task:
            return Task(config=self.tasks_config["comparison_task"], output_pydantic=ComparisonSummary)

        @crew
        def build_crew(self) -> Crew:
            return Crew(agents=self.agents, tasks=self.tasks, process=Process.sequential, verbose=False)

    output = ComparisonCrew().build_crew().kickoff(inputs={"candidate_summaries_block": "\n".join(lines)})
    parsed = getattr(output, "pydantic", None)
    return parsed.comparison_text if isinstance(parsed, ComparisonSummary) else None


def run(payload: dict, explain: bool = True, use_rag: bool = True) -> dict:
    facts = analyze(payload, use_rag=use_rag)
    if not explain:
        return facts

    enable_llm = os.getenv("ENABLE_LLM_EXPLANATION", "true").strip().lower() != "false"
    has_key = bool(os.getenv("OPENAI_API_KEY"))
    facts["comparison_summary"] = None

    if not enable_llm or not has_key:
        facts["explain_mode"] = "disabled"
        facts["explanation_markdown"] = _fallback_explanation(facts)
        for c in facts["candidates"]:
            c["ai_explanation"] = _fallback_candidate_explanation(c)
        return facts

    try:
        explanations = _generate_candidate_explanations(facts)
        for c in facts["candidates"]:
            c["ai_explanation"] = explanations[c["site_id"]]
        facts["explain_mode"] = "llm"
        facts["explanation_markdown"] = "\n\n".join(
            f"[{c['site_id']}] {c['ai_explanation']['candidate_interpretation']}" for c in facts["candidates"]
        )
    except Exception as e:  # noqa: BLE001
        # Generation 실패가 Rule Engine + Retrieval 결과까지 막으면 안 된다.
        logger.exception("AI 설명 생성 실패")
        facts["explain_mode"] = "rule_rag_fallback"
        facts["explain_error"] = str(e)[:400]
        facts["explanation_markdown"] = _fallback_explanation(facts)
        for c in facts["candidates"]:
            c["ai_explanation"] = _fallback_candidate_explanation(c, failed=True)
        return facts

    try:
        facts["comparison_summary"] = _generate_comparison_summary(facts, explanations)
    except Exception:  # noqa: BLE001
        logger.exception("후보 비교 요약 생성 실패 (후보별 설명은 유지)")
        facts["comparison_summary"] = None

    return facts


DEMO_PAYLOAD = {
    "business_name": "스테이 커피",
    "industry": "카페",
    "can_continue_current": True,
    "current": {
        "monthly_sales": 2800,
        "variable_cost": 1120,
        "fixed_cost": 930,
        "deposit": 2000,
        "available_cash": 1500,
    },
    "candidates": [
        {
            "site_id": "A",
            "name": "서울 강남구 테헤란로 123",
            "monthly_rent": 250,
            "maintenance_fee": 20,
            "other_fixed_cost": 450,
            "deposit": 3000,
            "interior_cost": 2500,
            "moving_cost": 500,
            "restoration_cost": 300,
            "rights_fee": 0,
            "closed_days": 15,
            "target_months": 24,
        },
    ],
}


if __name__ == "__main__":
    import sys

    do_llm = "--explain" in sys.argv
    no_rag = "--no-rag" in sys.argv
    out = run(DEMO_PAYLOAD, explain=do_llm, use_rag=not no_rag)
    print(json.dumps(out, ensure_ascii=False, indent=2))
