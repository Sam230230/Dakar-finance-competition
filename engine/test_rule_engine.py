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


def test_key_money_and_restoration_cost_included():
    """권리금·원상복구비가 실제이전비용/추가필요자금에 반영되는지 확인."""
    c = CurrentStore(28_000_000, 11_200_000, 9_300_000, deposit=20_000_000, available_cash=0)
    cand = CandidateStore("t", monthly_rent=8_000_000, deposit=20_000_000,
                          key_money=45_000_000, restoration_cost=6_000_000)
    r = compute(c, cand)
    assert approx(r.actual_relocation_cost, 51_000_000), r.actual_relocation_cost
    # 보증금 차액 0 + 실제이전비용 51M - 가용현금 0 = 51M 그대로 부족
    assert approx(r.initial_relocation_capital, 51_000_000), r.initial_relocation_capital
    print("✓ 권리금·원상복구비 반영: 실제이전비용/추가필요자금에 정확히 합산됨")


def test_available_cash_nets_against_capital_needed():
    """보유 가용현금이 이전자금 필요액에서 순액으로 차감되는지(부족분/여유분) 확인."""
    c = CurrentStore(28_000_000, 11_200_000, 9_300_000, deposit=20_000_000, available_cash=60_000_000)
    cand = CandidateStore("t", monthly_rent=8_000_000, deposit=20_000_000,
                          key_money=45_000_000, restoration_cost=6_000_000)  # 실제이전비용 51M
    r = compute(c, cand)
    # 51M(총소요) - 60M(가용현금) = -9M → 여유(surplus) → 카드에는 0으로 표시
    assert approx(r.cash_shortfall_or_surplus, -9_000_000), r.cash_shortfall_or_surplus
    assert r.initial_relocation_capital == 0.0, r.initial_relocation_capital
    print("✓ 가용현금 순액 처리: 여유분이면 추가 필요자금이 0으로 표시됨(원액은 음수로 보존)")


def test_zero_sales_no_crash():
    """매출 0 입력도 크래시 없이 처리(경고)."""
    c = CurrentStore(0, 0, 5_000_000)
    cand = CandidateStore("t", monthly_rent=3_000_000)
    r = compute(c, cand)  # 예외 없이 반환되어야 함
    print("✓ 매출 0 엣지케이스: 크래시 없음 (경고 =", bool(r.warnings), ")")


def test_target_period_reverse_consistency():
    """역산 검증: 목표기간 필요매출로 영업하면 (실제이전비용/개월+후보고정비+현재손익)/공헌이익률 공식과 일치해야 함.
    (주의: 이 값은 '미래 매출 예측'이 아니라 임계값 역산이므로, 실현 여부를 별도로 가정하지 않는다.)"""
    c = CurrentStore(28_000_000, 11_200_000, 9_300_000)
    cand = CandidateStore("t", monthly_rent=8_000_000, maintenance_fee=800_000,
                          other_fixed_cost=2_000_000, interior_cost=25_000_000,
                          moving_cost=5_000_000)
    r = compute(c, cand)
    cm = r.contribution_margin_rate
    for months, req_sales in r.target_period_required_sales.items():
        expected = (r.actual_relocation_cost / months + r.candidate_fixed_cost + r.current_operating_profit) / cm
        assert approx(req_sales, expected, 1.0), (months, req_sales, expected)
    print("✓ 목표기간 역산 일관성: 12/24/36개월 필요매출이 공식과 정확히 일치")


if __name__ == "__main__":
    for fn in [test_current_profit_matches_doc, test_min_required_and_retention,
               test_key_money_and_restoration_cost_included,
               test_available_cash_nets_against_capital_needed,
               test_zero_sales_no_crash,
               test_target_period_reverse_consistency]:
        fn()
    print("\n✅ 전체 통과")
