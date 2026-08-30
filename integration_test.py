"""Latest integrated smoke/integration checks for candidate-based onboarding.

Usage:
  python integration_test.py --no-rag
  python integration_test.py
  python integration_test.py --explain   # requires OPENAI_API_KEY for LLM
"""
from __future__ import annotations

import argparse
import json

import staymove

BASE_CURRENT = {
    "address": "서울 마포구 연남동",
    "monthly_sales": 2800,
    "variable_cost": 980,
    "fixed_cost": 1000,
    "deposit": 3000,
    "available_self_fund": 1500,
}


def cand(site_id, address, monthly_total):
    # keep simple: rent + management + other = monthly_total
    return {
        "site_id": site_id,
        "name": address,
        "monthly_rent": monthly_total - 150,
        "maintenance_fee": 100,
        "other_fixed_cost": 50,
        "deposit": 3000,
        "interior_cost": 1200,
        "moving_cost": 120,
        "restoration_cost": 250,
        "rights_fee": 100,
        "other_moving_cost": 50,
        "closed_days": 5,
    }


CASES = [
    (
        "CASE 1: A growth_opportunity / 회수기간 미사용",
        {
            "business_name": "우리 매장",
            "industry": "커피-음료",
            "industry_code": "CS100010",
            "current": BASE_CURRENT,
            "target_recovery_months": None,
            "candidates": [cand("A", "서울 강남구 역삼동", 1300)],
        },
        {"A": "growth_opportunity"},
    ),
    (
        "CASE 2: A cost_recovery / 17개월",
        {
            "business_name": "우리 매장",
            "industry": "커피-음료",
            "industry_code": "CS100010",
            "current": BASE_CURRENT,
            "target_recovery_months": 17,
            "candidates": [cand("A", "서울 마포구 망원동", 800)],
        },
        {"A": "cost_recovery"},
    ),
    (
        "CASE 3: A growth, B/C recovery",
        {
            "business_name": "우리 매장",
            "industry": "커피-음료",
            "industry_code": "CS100010",
            "current": BASE_CURRENT,
            "target_recovery_months": 24,
            "candidates": [
                cand("A", "서울 성동구 성수동", 1300),
                cand("B", "서울 관악구 봉천동", 850),
                cand("C", "서울 은평구 응암동", 700),
            ],
        },
        {"A": "growth_opportunity", "B": "cost_recovery", "C": "cost_recovery"},
    ),
]


def run_case(title, payload, expected, use_rag, explain):
    print("\n" + "=" * 76)
    print(title)
    print("=" * 76)
    out = staymove.run(payload, explain=explain, use_rag=use_rag, use_ml=True)
    got = {c["site_id"]: c["analysis_mode"] for c in out["candidates"]}
    assert got == expected, (got, expected)
    for c in out["candidates"]:
        if c["analysis_mode"] == "growth_opportunity":
            assert c["target_months"] is None
        else:
            assert c["target_months"] == payload["target_recovery_months"]
        assert "ml" in c and "policy_rag" in c
        print(
            c["site_id"], c["analysis_mode"],
            "monthly=", c["monthly_operating_cost"],
            "ML=", c["ml"].get("status"),
            "RAG=", c["policy_rag"].get("status"),
        )
    print("performance:", json.dumps(out.get("performance", {}), ensure_ascii=False))
    return out


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-rag", action="store_true")
    parser.add_argument("--explain", action="store_true")
    args = parser.parse_args()
    for title, payload, expected in CASES:
        run_case(title, payload, expected, use_rag=not args.no_rag, explain=args.explain)
    print("\nALL CASES PASSED")
