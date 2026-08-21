"""규칙엔진 검산 + 엣지케이스. 실행: python engine/test_rule_engine.py"""
import math
from rule_engine import CurrentStore, CandidateStore, compute


def approx(a, b, tol=1.0):
    return abs(a - b) <= tol


def test_current_profit_matches_doc():
    """문서 STEP1 예시: 28M - 11.2M - 9.3M = 7.5M, 변동비율 40%, 공헌이익률 60%."""
    c = CurrentStore(28_000_000, 11_200_000, 9_300_000, deposit=20_000_000)
    assert approx(c.operating_profit, 7_500_000), c.operating_profit
    assert approx(c.variable_cost_rate, 0.40, 1e-6)
    assert approx(c.contribution_margin_rate, 0.60, 1e-6)
    print("✓ 현재 손익 검산: 7,500,000원 / 공헌이익률 60% 일치")


def test_min_required_and_retention():
    """최소필요매출=(후보고정비+현재손익)/공헌이익률, 유지율=최소필요/현재매출."""
    c = CurrentStore(28_000_000, 11_200_000, 9_300_000)
    cand = CandidateStore("t", monthly_rent=8_000_000, maintenance_fee=800_000,
                          other_fixed_cost=2_000_000)  # 고정비 10.8M
    r = compute(c, cand)
    expected_min = (10_800_000 + 7_500_000) / 0.60  # = 30,500,000
    assert approx(r.min_required_sales, expected_min), r.min_required_sales
    assert approx(r.required_retention, expected_min / 28_000_000, 1e-6)
    print(f"✓ 최소필요매출 검산: {r.min_required_sales:,.0f}원 (유지율 {r.required_retention:.1%})")


def test_payback_guard_negative():
    """후보가 현재보다 안 남으면(월개선<=0) 회수기간=None(=회수 어려움)."""
    c = CurrentStore(28_000_000, 11_200_000, 9_300_000)
    # 후보 고정비를 아주 크게 → 어떤 유지율에도 개선액 음수
    cand = CandidateStore("bad", monthly_rent=20_000_000, interior_cost=25_000_000)
    r = compute(c, cand)
    assert all(s.payback_months is None for s in r.payback_scenarios)
    print("✓ 분모 0/음수 가드: 개선액<=0 시 '회수 어려움'으로 안전 처리")


def test_zero_sales_no_crash():
    """매출 0 입력도 크래시 없이 처리(경고)."""
    c = CurrentStore(0, 0, 5_000_000)
    cand = CandidateStore("t", monthly_rent=3_000_000)
    r = compute(c, cand)  # 예외 없이 반환되어야 함
    print("✓ 매출 0 엣지케이스: 크래시 없음 (경고 =", bool(r.warnings), ")")


def test_target_period_reverse_consistency():
    """역산 검증: 목표기간 필요매출로 영업하면 실제 회수기간이 목표와 같아야 함."""
    c = CurrentStore(28_000_000, 11_200_000, 9_300_000)
    cand = CandidateStore("t", monthly_rent=8_000_000, maintenance_fee=800_000,
                          other_fixed_cost=2_000_000, interior_cost=25_000_000,
                          moving_cost=5_000_000)
    r = compute(c, cand)
    cm = r.contribution_margin_rate
    for months, req_sales in r.target_period_required_sales.items():
        cand_op = req_sales * cm - r.candidate_fixed_cost
        gain = cand_op - r.current_operating_profit
        payback = r.actual_relocation_cost / gain
        assert approx(payback, months, 0.05), (months, payback)
    print("✓ 목표기간 역산 일관성: 12/24/36개월 필요매출 → 실제 회수기간 정확히 일치")


if __name__ == "__main__":
    for fn in [test_current_profit_matches_doc, test_min_required_and_retention,
               test_payback_guard_negative, test_zero_sales_no_crash,
               test_target_period_reverse_consistency]:
        fn()
    print("\n✅ 전체 통과")
