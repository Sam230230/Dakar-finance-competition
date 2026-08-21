"""
Stay or Move 오케스트레이터 — 규칙엔진(계산) + 채점/순위 + CrewAI(자연어 설명).

흐름:
    현재매장 + 후보 계약조건
      → rule_engine.compute() 로 후보별 경제성 계산 (결정론)
      → 경제성 채점·순위 → 추천 후보 결정 (결정론)
      → facts(JSON) 구성
      → CrewAI explainer 가 그 숫자를 '설명만' (LLM은 계산 안 함)

`analyze()` 까지는 OpenAI 키 없이 동작(테스트 가능).
`run(..., explain=True)` 에서만 CrewAI/LLM 호출.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict
from typing import List, Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

from pydantic import BaseModel, Field

from engine.rule_engine import CurrentStore, CandidateStore, compute, StayMoveResult


# =====================================================================
#  입력 모델
# =====================================================================
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
    other_fixed_cost: float = 0.0    # 인건비 등 새 매장에서 발생할 고정비
    deposit: float = 0.0
    interior_cost: float = 0.0
    moving_cost: float = 0.0
    other_moving_cost: float = 0.0
    closed_days: int = 0


class StayMoveIn(BaseModel):
    business_name: str = "우리 매장"
    current: CurrentStoreIn
    candidates: List[CandidateIn] = Field(..., min_length=1)


# =====================================================================
#  채점 (경제성 기반, 투명·설명가능)
# =====================================================================
def _clamp(x, lo, hi):
    return max(lo, min(hi, x))


def _economic_score(res: StayMoveResult) -> dict:
    """필요 유지율(낮을수록↑)과 95% 시나리오 회수기간(짧을수록↑)으로 0~100 채점."""
    rr = res.required_retention
    # 유지율 성분 0~60: 0.70 → 60점, 1.30 → 0점
    ret = _clamp((1.30 - rr) / (1.30 - 0.70) * 60, 0, 60) if rr == rr else 0
    # 회수 성분 0~40: 95% 유지 시나리오의 회수기간 12개월→40, 48개월→0
    sc = next((s for s in res.payback_scenarios if abs(s.retention - 0.95) < 1e-9), None)
    pm = sc.payback_months if sc else None
    pay = 0 if pm is None else _clamp((48 - pm) / (48 - 12) * 40, 0, 40)
    return {"total": round(ret + pay), "retention_pts": round(ret), "payback_pts": round(pay)}


def analyze(payload: dict) -> dict:
    """결정론 경로: 후보별 계산 + 채점 + 순위. (LLM 없음)"""
    data = StayMoveIn(**payload)
    cur = CurrentStore(
        monthly_sales=data.current.monthly_sales,
        variable_cost=data.current.variable_cost,
        fixed_cost=data.current.fixed_cost,
        deposit=data.current.deposit,
    )
    ranked = []
    for c in data.candidates:
        cand = CandidateStore(
            name=c.name, monthly_rent=c.monthly_rent, maintenance_fee=c.maintenance_fee,
            other_fixed_cost=c.other_fixed_cost, deposit=c.deposit,
            interior_cost=c.interior_cost, moving_cost=c.moving_cost,
            other_moving_cost=c.other_moving_cost, closed_days=c.closed_days,
        )
        res = compute(cur, cand)
        score = _economic_score(res)
        ranked.append({
            "site_id": c.site_id, "name": c.name,
            "score": score["total"], "score_detail": score,
            "min_required_sales": round(res.min_required_sales),
            "required_retention": round(res.required_retention, 4),
            "initial_capital": round(res.initial_relocation_capital),
            "actual_relocation_cost": round(res.actual_relocation_cost),
            "scenarios": [
                {"retention": s.retention,
                 "monthly_gain": round(s.monthly_gain) if s.monthly_gain == s.monthly_gain else None,
                 "payback_months": round(s.payback_months, 1) if s.payback_months else None}
                for s in res.payback_scenarios
            ],
            "warnings": res.warnings,
        })

    # 점수 내림차순, 동점이면 필요 유지율 낮은 쪽
    ranked.sort(key=lambda r: (-r["score"], r["required_retention"]))
    recommended = ranked[0]["site_id"]

    # 판정: 추천 후보의 유지율로 결정
    top = ranked[0]
    rr = top["required_retention"]
    if rr <= 0.90:
        decision = "immediate"      # 즉시 이전 권장
    elif rr <= 1.00:
        decision = "conditional"    # 조건부 권장
    else:
        decision = "reconsider"     # 재검토 권고

    return {
        "business_name": data.business_name,
        "current_operating_profit": round(cur.operating_profit),
        "contribution_margin_rate": round(cur.contribution_margin_rate, 4),
        "recommended": recommended,
        "decision": decision,
        "ranking": ranked,
    }


# =====================================================================
#  CrewAI 설명 (LLM은 '설명만')
# =====================================================================
def _explain_with_crew(facts: dict) -> str:
    from crewai import Agent, Crew, Process, Task
    from crewai.project import CrewBase, agent, task, crew

    @CrewBase
    class StayMoveExplainerCrew:
        agents_config = "config/staymove_agents.yaml"
        tasks_config = "config/staymove_tasks.yaml"

        @agent
        def explainer(self) -> Agent:
            return Agent(config=self.agents_config["explainer"],
                         llm=os.getenv("OPENAI_MODEL_NAME", "gpt-4o-mini"), verbose=True)

        @task
        def explain_task(self) -> Task:
            return Task(config=self.tasks_config["explain_task"])

        @crew
        def crew(self) -> Crew:
            return Crew(agents=self.agents, tasks=self.tasks,
                        process=Process.sequential, verbose=True)

    inputs = {
        "business_name": facts["business_name"],
        "recommended": facts["recommended"],
        "facts_json": json.dumps(facts, ensure_ascii=False, indent=2),
    }
    result = StayMoveExplainerCrew().crew().kickoff(inputs=inputs)
    return str(getattr(result, "raw", result))


def _fallback_explanation(facts: dict) -> str:
    """LLM 없이도 숫자로 만드는 결정론 설명(AI 설명이 실패할 때 대체)."""
    rank = facts["ranking"]
    top = rank[0]
    dec = {"immediate": "이전을 권장", "conditional": "조건부로 이전을 권장",
           "reconsider": "재검토를 권고"}.get(facts["decision"], "검토")
    lines = [
        f"{top['site_id']}({top['name']})로 {dec}합니다. "
        f"현재 수익을 유지하려면 새 매장에서 월 {top['min_required_sales']:,}만원(현재 매출의 "
        f"{top['required_retention']*100:.1f}%)을 팔면 됩니다. 초기 이전 자금은 약 "
        f"{top['initial_capital']:,}만원입니다.",
    ]
    if len(rank) > 1:
        others = ", ".join(f"{r['site_id']}(유지율 {r['required_retention']*100:.0f}%)" for r in rank[1:])
        lines.append(f"차순위 후보는 {others} 순입니다.")
    lines.append("※ 매출 수치는 거래내역 기반 계산값입니다. (AI 자연어 설명은 현재 사용 불가 — 아래 사유 참고)")
    return "\n\n".join(lines)


def run(payload: dict, explain: bool = True) -> dict:
    """전체 실행. explain=False 면 계산·순위만(LLM 없음).
    explain=True 라도 LLM 단계가 실패하면 계산 결과 + 결정론 설명으로 폴백(500 안 냄)."""
    facts = analyze(payload)
    if explain:
        try:
            facts["explanation_markdown"] = _explain_with_crew(facts)
        except Exception as e:  # noqa: BLE001
            facts["explanation_markdown"] = _fallback_explanation(facts)
            facts["explain_error"] = str(e)[:400]
    return facts


# =====================================================================
#  데모
# =====================================================================
DEMO_PAYLOAD = {
    "business_name": "아무개 커피",
    "current": {"monthly_sales": 2800, "variable_cost": 1120, "fixed_cost": 930, "deposit": 2000},
    "candidates": [
        {"site_id": "A", "name": "성수동 카페거리 1층", "monthly_rent": 450, "maintenance_fee": 30,
         "other_fixed_cost": 450, "deposit": 3000, "interior_cost": 2500, "moving_cost": 500, "closed_days": 15},
        {"site_id": "B", "name": "망원동 주택가 코너 1층", "monthly_rent": 250, "maintenance_fee": 20,
         "other_fixed_cost": 450, "deposit": 3000, "interior_cost": 2500, "moving_cost": 500, "closed_days": 15},
        {"site_id": "C", "name": "여의도 오피스가 지하1층", "monthly_rent": 350, "maintenance_fee": 40,
         "other_fixed_cost": 450, "deposit": 2500, "interior_cost": 2000, "moving_cost": 500, "closed_days": 15},
    ],
}


if __name__ == "__main__":
    import sys
    do_llm = "--explain" in sys.argv  # 기본은 계산만(무료). --explain 붙이면 LLM 호출.
    out = run(DEMO_PAYLOAD, explain=do_llm)
    print(f"추천: {out['recommended']} · 판정: {out['decision']}")
    print("순위:")
    for r in out["ranking"]:
        print(f"  {r['site_id']} {r['name']}: {r['score']}점 · 최소필요 {r['min_required_sales']}만 "
              f"· 유지율 {r['required_retention']*100:.1f}%")
    if "explanation_markdown" in out:
        print("\n── AI 설명 ──\n" + out["explanation_markdown"])
