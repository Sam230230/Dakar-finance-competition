"""터미널에서 최종 흐름을 확인하는 통합 테스트.

기본: Rule Engine + 정책 RAG (Retrieval only)
빠른 계산만 확인: python3 integration_test.py --no-rag
AI 설명 생성까지 확인: python3 integration_test.py --explain
"""
from __future__ import annotations

import argparse

import staymove


CURRENT = {
    "monthly_sales": 2800,
    "variable_cost": 1120,
    "fixed_cost": 930,
    "deposit": 2000,
    "available_cash": 1500,
}


def candidate(site_id: str, address: str, rent: int, deposit: int, interior: int) -> dict:
    return {
        "site_id": site_id,
        "name": address,
        "monthly_rent": rent,
        "maintenance_fee": 20,
        "other_fixed_cost": 450,
        "deposit": deposit,
        "interior_cost": interior,
        "moving_cost": 500,
        "restoration_cost": 300,
        "rights_fee": 0,
        "other_moving_cost": 0,
        "closed_days": 15,
        "target_months": 24,
    }


CASES = [
    (
        "A. 자발적 이전 — Stay vs Move",
        {
            "business_name": "스테이 커피",
            "industry": "카페",
            "can_continue_current": True,
            "current_operating_status": "영업 중",
            "current": CURRENT,
            "candidates": [candidate("A", "서울 강남구 테헤란로 123", 250, 3000, 2500)],
        },
    ),
    (
        "B. 비자발적 이전 — Move vs Move",
        {
            "business_name": "스테이 커피",
            "industry": "카페",
            "can_continue_current": False,
            "current_operating_status": "영업 중",
            "current": CURRENT,
            "candidates": [
                candidate("A", "서울 마포구 망원로 50", 250, 3000, 2500),
                candidate("B", "서울 성동구 성수이로 10", 280, 3200, 2200),
                candidate("C", "서울 관악구 관악로 100", 210, 2600, 1800),
            ],
        },
    ),
]


def print_case(title: str, payload: dict, use_rag: bool, explain: bool) -> None:
    out = staymove.run(payload, explain=explain, use_rag=use_rag)
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)
    print(f"이전유형: {out['relocation_type']} / 비교모드: {out['comparison_mode']}")
    print(f"현재 영업이익: {out['current_operating_profit']:,}만원")
    print(f"보유 가용현금: {out['current_available_cash']:,}만원")
    if explain:
        print(f"explain_mode: {out.get('explain_mode')}")

    for row in out["candidates"]:
        print("\n" + "-" * 72)
        print(f"후보 {row['site_id']} | {row['name']} | {row['candidate_region'] or '지역 미확인'}")
        print("[Rule Engine]")
        print(f"최소 필요 월매출      : {row['min_required_sales']:,}만원")
        print(f"필요 매출 유지율      : {row['required_retention'] * 100:.1f}%")
        print(f"초기 이전 소요자금    : {row['initial_capital']:,}만원")
        print(f"추가 필요 이전자금    : {row['additional_fund_needed']:,}만원")
        print(f"RAG 전달 금액         : {row['additional_fund_needed_krw']:,}원")

        rag = row["policy_rag"]
        print("[Policy RAG]")
        print(f"상태: {rag['status']} / {rag['message']}")
        for i, p in enumerate(rag.get("results", []), 1):
            print(f"  {i}. {p['name']}")
            print(f"     범위={p['region_slot']} | 유형={p['support_type']} | 금리={p['interest_rate']} | 한도={p['amount_limit']}")
            print(f"     업력={p['business_age_requirement']} | 자격추가확인={'예' if p['eligibility_needs_check'] else '아니오'}")

        if explain:
            exp = row.get("ai_explanation") or {}
            print(f"[AI 설명 | mode={exp.get('mode')}]")
            fin = exp.get("financial_summary", {})
            print(f"  재무요약: {fin.get('summary', '')}")
            for i, p in enumerate(exp.get("policy_summary", []), 1):
                print(f"  정책{i}. {p.get('policy_name')} ({p.get('region_slot')})")
                print(f"     관련성: {p.get('why_relevant')}")
                print(f"     조건: {p.get('key_condition')} | 주의: {p.get('caution')}")
            print(f"  종합설명: {exp.get('candidate_interpretation')}")
            if exp.get("important_checks"):
                print("  확인사항:")
                for chk in exp["important_checks"]:
                    print(f"    - {chk}")

    if explain and out.get("comparison_summary"):
        print("\n[후보 비교 요약]")
        print(out["comparison_summary"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-rag", action="store_true", help="RAG 모델을 로드하지 않고 Rule Engine 연결만 확인")
    parser.add_argument("--explain", action="store_true", help="LLM Generation(후보별 AI 설명)까지 실행")
    args = parser.parse_args()
    for title, payload in CASES:
        print_case(title, payload, use_rag=not args.no_rag, explain=args.explain)
