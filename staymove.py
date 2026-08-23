"""
Stay or Move 오케스트레이터 — 규칙엔진(계산) + LLM 설명.

핵심 원칙:
  - 추천/점수화/자동 순위 없음.
  - 후보별 경제성 기준을 동일한 방식으로 계산해 사용자가 비교·판단.
  - LLM은 숫자를 계산하지 않고 이미 계산된 사실을 설명만 함.
"""
from __future__ import annotations

import json
import os
from typing import List

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

from pydantic import BaseModel, Field

from engine.rule_engine import CurrentStore, CandidateStore, compute


class CurrentStoreIn(BaseModel):
    monthly_sales: float
    variable_cost: float
    fixed_cost: float
    deposit: float = 0.0


class CandidateIn(BaseModel):
    site_id: str
    name: str
    monthly_rent: float
    maintenance_fee: float = 0.0
    other_fixed_cost: float = 0.0
    deposit: float = 0.0
    interior_cost: float = 0.0
    moving_cost: float = 0.0
    other_moving_cost: float = 0.0
    closed_days: int = 0


class StayMoveIn(BaseModel):
    business_name: str = "우리 매장"
    current: CurrentStoreIn
    candidates: List[CandidateIn] = Field(..., min_length=1, max_length=5)


def analyze(payload: dict) -> dict:
    """후보별 경제성 계산. 추천/점수화 없이 입력 순서대로 반환."""
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
    for c in data.candidates:
        cand = CandidateStore(
            name=c.name,
            monthly_rent=c.monthly_rent,
            maintenance_fee=c.maintenance_fee,
            other_fixed_cost=c.other_fixed_cost,
            deposit=c.deposit,
            interior_cost=c.interior_cost,
            moving_cost=c.moving_cost,
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
            })

        analyses.append({
            "site_id": c.site_id,
            "name": c.name,
            "min_required_sales": round(res.min_required_sales),
            "required_retention": round(res.required_retention, 4),
            "initial_capital": round(res.initial_relocation_capital),
            "net_deposit_change": round(res.net_deposit_change),
            "actual_relocation_cost": round(res.actual_relocation_cost),
            "candidate_fixed_cost": round(res.candidate_fixed_cost),
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
            "warnings": res.warnings,
        })

    return {
        "business_name": data.business_name,
        "current_operating_profit": round(cur.operating_profit),
        "current_monthly_sales": round(cur.monthly_sales),
        "contribution_margin_rate": round(cur.contribution_margin_rate, 4),
        "candidates": analyses,
        "assumptions": [
            "후보 매장에서도 현재 매장과 동일한 변동비율이 유지된다고 가정합니다.",
            "현재 보증금은 이전 시점에 회수해 후보 보증금에 재투입할 수 있다고 가정합니다.",
            "이전비 회수기간은 후보 매장의 월 운영이익이 현재 매장보다 증가하는 경우에만 계산합니다.",
        ],
    }


def _explain_with_crew(facts: dict) -> str:
    from crewai import Agent, Crew, Process, Task
    from crewai.project import CrewBase, agent, task, crew

    @CrewBase
    class StayMoveExplainerCrew:
        agents_config = "config/staymove_agents.yaml"
        tasks_config = "config/staymove_tasks.yaml"

        @agent
        def explainer(self) -> Agent:
            return Agent(
                config=self.agents_config["explainer"],
                llm=os.getenv("OPENAI_MODEL_NAME", "gpt-4o-mini"),
                verbose=True,
            )

        @task
        def explain_task(self) -> Task:
            return Task(config=self.tasks_config["explain_task"])

        @crew
        def crew(self) -> Crew:
            return Crew(agents=self.agents, tasks=self.tasks, process=Process.sequential, verbose=True)

    inputs = {
        "business_name": facts["business_name"],
        "facts_json": json.dumps(facts, ensure_ascii=False, indent=2),
    }
    result = StayMoveExplainerCrew().crew().kickoff(inputs=inputs)
    return str(getattr(result, "raw", result))


def _fallback_explanation(facts: dict) -> str:
    """LLM 실패 시 계산 결과만 이용한 설명."""
    lines = []
    for c in facts["candidates"]:
        lines.append(
            f"{c['site_id']}({c['name']})는 현재 월 수익을 유지하려면 월 "
            f"{c['min_required_sales']:,}만원, 현재 매출의 {c['required_retention']*100:.1f}%가 필요합니다. "
            f"초기 이전 소요자금은 약 {c['initial_capital']:,}만원입니다."
        )
        p24 = next((x for x in c["target_periods"] if x["months"] == 24), None)
        if p24:
            lines.append(
                f"24개월 내 실제 이전비를 회수하려면 월 {p24['required_sales']:,}만원, "
                f"현재 매출의 {p24['required_retention']*100:.1f}%가 필요합니다."
            )
    lines.append("※ 위 수치는 규칙엔진의 계산값이며, 이전 여부를 자동 추천하는 점수는 사용하지 않습니다.")
    return "\n\n".join(lines)


def run(payload: dict, explain: bool = True) -> dict:
    facts = analyze(payload)
    if explain:
        # 공모전 데모에서는 OPENAI_API_KEY가 없어도 즉시 동작한다.
        # 키가 없으면 CrewAI를 시도하지 않고 결정론적 설명으로 폴백.
        if not os.getenv("OPENAI_API_KEY"):
            facts["explanation_markdown"] = _fallback_explanation(facts)
            facts["explain_mode"] = "rule_based_demo"
        else:
            try:
                facts["explanation_markdown"] = _explain_with_crew(facts)
                facts["explain_mode"] = "llm"
            except Exception as e:  # noqa: BLE001
                facts["explanation_markdown"] = _fallback_explanation(facts)
                facts["explain_mode"] = "rule_based_fallback"
                facts["explain_error"] = str(e)[:400]
    return facts


DEMO_PAYLOAD = {
    "business_name": "아무개 커피",
    "current": {"monthly_sales": 2800, "variable_cost": 1120, "fixed_cost": 930, "deposit": 2000},
    "candidates": [
        {"site_id": "A", "name": "서울 마포구 망원로 50", "monthly_rent": 250, "maintenance_fee": 20,
         "other_fixed_cost": 450, "deposit": 3000, "interior_cost": 2500, "moving_cost": 500, "closed_days": 15},
    ],
}


if __name__ == "__main__":
    import sys
    do_llm = "--explain" in sys.argv
    out = run(DEMO_PAYLOAD, explain=do_llm)
    print(json.dumps(out, ensure_ascii=False, indent=2))
