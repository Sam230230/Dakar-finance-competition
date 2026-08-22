"""
Stay or Move 오케스트레이터 — 규칙엔진(계산) + 채점/순위 + CrewAI(자연어 설명).

흐름:
    현재매장 + 후보 계약조건
      → rule_engine.compute() 로 후보별 경제성 계산 (결정론, 임계값형만 — 예측형 지표 없음)
      → 경제성 채점·순위 → 상위 후보 결정 (결정론)
      → facts(JSON) 구성
      → CrewAI explainer 가 그 숫자를 '설명만' (LLM은 계산도, 최종 추천도 하지 않는다)

`analyze()` 까지는 OpenAI 키 없이 동작(테스트 가능).
`run(..., explain=True)` 에서만 CrewAI/LLM 호출.

주의: 여기서 나오는 `decision`/순위는 "추천"이 아니라 사용자가 스스로 판단할 수 있게
현재 확보된 숫자를 기준으로 분류한 "판정 결과"다. 최종 결정은 사용자의 몫이며,
설명(explainer)도 이를 '추천'이 아닌 '판단 근거 제시'로 서술해야 한다.
"""
from __future__ import annotations

import json
import os
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
    available_cash: float = 0.0      # 보유 가용현금 (사용자 입력)


class CandidateIn(BaseModel):
    site_id: str
    name: str
    monthly_rent: float
    maintenance_fee: float = 0.0
    other_fixed_cost: float = 0.0    # 인건비 등 새 매장에서 발생할 고정비
    deposit: float = 0.0
    key_money: float = 0.0           # 권리금 (사용자 입력 필수 — 공공데이터 없음)
    interior_cost: float = 0.0
    moving_cost: float = 0.0
    restoration_cost: float = 0.0    # 원상복구비 (사용자 입력 필수 — 공공데이터 없음)
    other_moving_cost: float = 0.0
    closed_days: int = 0


class StayMoveIn(BaseModel):
    business_name: str = "우리 매장"
    current: CurrentStoreIn
    candidates: List[CandidateIn] = Field(..., min_length=1)


# =====================================================================
#  채점 (경제성 기반, 투명·설명가능)
#  ※ 미래 매출 유지를 가정하는 예측형 지표(회수기간 시나리오 등)는
#    순위/추천에 영향을 주지 않도록 배제한다 — 현재 확정된 숫자(필요 유지율)만 사용.
# =====================================================================
def _clamp(x, lo, hi):
    return max(lo, min(hi, x))


def _economic_score(res: StayMoveResult) -> dict:
    """필요 유지율만으로 0~100점 채점 (낮을수록 유리).
    0.70 이하 → 100점, 1.30 이상 → 0점, 선형 보간."""
    rr = res.required_retention
    score = _clamp((1.30 - rr) / (1.30 - 0.70) * 100, 0, 100) if rr == rr else 0
    return {"total": round(score), "retention_pts": round(score)}


def analyze(payload: dict) -> dict:
    """결정론 경로: 후보별 계산 + 채점 + 순위. (LLM 없음)"""
    data = StayMoveIn(**payload)
    cur = CurrentStore(
        monthly_sales=data.current.monthly_sales,
        variable_cost=data.current.variable_cost,
        fixed_cost=data.current.fixed_cost,
        deposit=data.current.deposit,
        available_cash=data.current.available_cash,
    )
    ranked = []
    for c in data.candidates:
        cand = CandidateStore(
            name=c.name, monthly_rent=c.monthly_rent, maintenance_fee=c.maintenance_fee,
            other_fixed_cost=c.other_fixed_cost, deposit=c.deposit,
            key_money=c.key_money, interior_cost=c.interior_cost, moving_cost=c.moving_cost,
            restoration_cost=c.restoration_cost, other_moving_cost=c.other_moving_cost,
            closed_days=c.closed_days,
        )
        res = compute(cur, cand)
        score = _economic_score(res)
        ranked.append({
            "site_id": c.site_id, "name": c.name,
            "score": score["total"], "score_detail": score,
            "min_required_sales": round(res.min_required_sales),
            "required_retention": round(res.required_retention, 4),
            "additional_capital_needed": round(res.initial_relocation_capital),
            "cash_shortfall_or_surplus": round(res.cash_shortfall_or_surplus),
            "actual_relocation_cost": round(res.actual_relocation_cost),
            "target_period_required_sales": {
                str(m): round(s) for m, s in res.target_period_required_sales.items()
            },
            "warnings": res.warnings,
        })

    # 점수 내림차순, 동점이면 필요 유지율 낮은 쪽
    ranked.sort(key=lambda r: (-r["score"], r["required_retention"]))
    top_site_id = ranked[0]["site_id"]

    # 판정: 최상위 후보의 필요 유지율 기준 3단계 분류.
    # "추천"이 아니라 사용자가 상황을 가늠할 수 있게 돕는 판정 라벨.
    top = ranked[0]
    rr = top["required_retention"]
    if rr <= 0.90:
        decision = "immediate"      # 여유 있음: 매출이 다소 떨어져도 이전이 유리
        decision_label = "여유 있음"
    elif rr <= 1.00:
        decision = "conditional"    # 빠듯함: 현재 매출을 거의 그대로 유지해야 함
        decision_label = "빠듯함"
    else:
        decision = "reconsider"     # 재검토 필요: 현재보다 매출이 더 필요함
        decision_label = "재검토 필요"

    return {
        "business_name": data.business_name,
        "current_operating_profit": round(cur.operating_profit),
        "contribution_margin_rate": round(cur.contribution_margin_rate, 4),
        "top_site_id": top_site_id,
        "decision": decision,
        "decision_label": decision_label,
        "ranking": ranked,
    }


# =====================================================================
#  CrewAI 설명 (LLM은 '설명만', 최종 추천 문구도 만들지 않음)
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
        "top_site_id": facts["top_site_id"],
        "facts_json": json.dumps(facts, ensure_ascii=False, indent=2),
    }
    result = StayMoveExplainerCrew().crew().kickoff(inputs=inputs)
    return str(getattr(result, "raw", result))


def _fallback_explanation(facts: dict) -> str:
    """LLM 없이도 숫자로 만드는 결정론 설명(AI 설명이 실패할 때 대체).
    '추천한다'는 문구 대신 판단 근거를 제시하는 톤으로 서술."""
    rank = facts["ranking"]
    top = rank[0]
    label = facts["decision_label"]
    lines = [
        f"{top['site_id']}({top['name']})의 판정은 '{label}'입니다. "
        f"현재 수익을 유지하려면 새 매장에서 월 {top['min_required_sales']:,}원(현재 매출의 "
        f"{top['required_retention']*100:.1f}%)을 팔아야 합니다. 추가로 필요한 이전 자금은 약 "
        f"{top['additional_capital_needed']:,}원(보유 가용현금 반영)입니다.",
    ]
    if len(rank) > 1:
        others = ", ".join(f"{r['site_id']}(유지율 {r['required_retention']*100:.0f}%)" for r in rank[1:])
        lines.append(f"다른 후보는 {others} 순입니다.")
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
#  데모 (단위: 원)
# =====================================================================
DEMO_PAYLOAD = {
    "business_name": "아무개 커피",
    "current": {"monthly_sales": 28_000_000, "variable_cost": 11_200_000,
                "fixed_cost": 9_300_000, "deposit": 20_000_000, "available_cash": 10_000_000},
    "candidates": [
        {"site_id": "A", "name": "성수동 카페거리 1층", "monthly_rent": 4_500_000, "maintenance_fee": 300_000,
         "other_fixed_cost": 4_500_000, "deposit": 30_000_000, "key_money": 45_000_000,
         "interior_cost": 25_000_000, "moving_cost": 5_000_000, "restoration_cost": 6_000_000,
         "closed_days": 15},
        {"site_id": "B", "name": "망원동 주택가 코너 1층", "monthly_rent": 2_500_000, "maintenance_fee": 200_000,
         "other_fixed_cost": 4_500_000, "deposit": 30_000_000, "key_money": 20_000_000,
         "interior_cost": 25_000_000, "moving_cost": 5_000_000, "restoration_cost": 6_000_000,
         "closed_days": 15},
        {"site_id": "C", "name": "여의도 오피스가 지하1층", "monthly_rent": 3_500_000, "maintenance_fee": 400_000,
         "other_fixed_cost": 4_500_000, "deposit": 25_000_000, "key_money": 30_000_000,
         "interior_cost": 20_000_000, "moving_cost": 5_000_000, "restoration_cost": 6_000_000,
         "closed_days": 15},
    ],
}


if __name__ == "__main__":
    import sys
    do_llm = "--explain" in sys.argv  # 기본은 계산만(무료). --explain 붙이면 LLM 호출.
    out = run(DEMO_PAYLOAD, explain=do_llm)
    print(f"1순위: {out['top_site_id']} · 판정: {out['decision_label']}")
    print("순위:")
    for r in out["ranking"]:
        print(f"  {r['site_id']} {r['name']}: {r['score']}점 · 최소필요 {r['min_required_sales']:,}원 "
              f"· 유지율 {r['required_retention']*100:.1f}% "
              f"· 추가필요자금 {r['additional_capital_needed']:,}원")
    if "explanation_markdown" in out:
        print("\n── AI 설명 ──\n" + out["explanation_markdown"])
