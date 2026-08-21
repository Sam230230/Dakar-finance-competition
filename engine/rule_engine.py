"""
Stay or Move — STEP 4 경제성 계산 규칙엔진 (Rule Engine)

설계 원칙(사용자 문서와 동일):
  - LLM은 이 파일에 절대 관여하지 않는다. 모든 금액은 검증 가능한 공식으로만 산출.
  - 서울시/소진공 상권 데이터는 여기 들어오지 않는다(설명 근거로만 쓰임).
  - 순수 파이썬(dataclass)만 사용 → 프레임워크·외부 의존성 없이 단독 검증 가능.

입력:
  - CurrentStore  : STEP 1에서 나온 현재 매장 손익
  - CandidateStore: STEP 2에서 사용자가 입력한 후보 매장 계약조건
출력:
  - StayMoveResult: 상단 카드 3개 + 시나리오 + 누적손익 (화면 7번 출력값과 1:1 대응)
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict


# =====================================================================
#  입력 모델
# =====================================================================
@dataclass
class CurrentStore:
    """STEP 1 산출값 — 현재 매장 손익구조."""
    monthly_sales: float          # 월평균 매출
    variable_cost: float          # 월평균 변동비(재료비 등)
    fixed_cost: float             # 월평균 고정비(임대료·관리비·인건비 등)
    deposit: float = 0.0          # 현재 보증금(회수되어 후보 보증금에 재투입 가능)

    # --- 파생값 ---
    @property
    def variable_cost_rate(self) -> float:
        # 매출이 0이면 변동비율을 0으로 둔다(0분모 방지).
        return self.variable_cost / self.monthly_sales if self.monthly_sales else 0.0

    @property
    def contribution_margin_rate(self) -> float:
        """공헌이익률 = 1 - 변동비율."""
        return 1.0 - self.variable_cost_rate

    @property
    def operating_profit(self) -> float:
        """월 운영 후 잔여금액 = 매출 - 변동비 - 고정비."""
        return self.monthly_sales - self.variable_cost - self.fixed_cost


@dataclass
class CandidateStore:
    """STEP 2 입력값 — 후보 매장 계약조건."""
    name: str
    monthly_rent: float           # 월세
    maintenance_fee: float = 0.0  # 관리비
    other_fixed_cost: float = 0.0 # 인건비 등 후보 매장에서 달라지는 고정비(선택)
    deposit: float = 0.0          # 후보 보증금
    interior_cost: float = 0.0    # 인테리어비
    moving_cost: float = 0.0      # 이사·철거비
    other_moving_cost: float = 0.0# 기타 이전비
    closed_days: int = 0          # 예상 휴업일수

    @property
    def fixed_cost(self) -> float:
        """후보 매장 월 고정비 = 월세 + 관리비 + 기타 고정비."""
        return self.monthly_rent + self.maintenance_fee + self.other_fixed_cost


# =====================================================================
#  출력 모델
# =====================================================================
@dataclass
class PaybackScenario:
    retention: float                    # 매출 유지율 (1.0 = 현재 100%)
    candidate_sales: float              # 그때의 후보 월매출
    candidate_operating_profit: float   # 그때의 후보 월 운영손익
    monthly_gain: float                 # 후보 - 현재 (월 개선액)
    payback_months: Optional[float]     # 회수기간(개월). 회수 불가 시 None


@dataclass
class StayMoveResult:
    # --- STEP 4-1 참고값 ---
    current_operating_profit: float
    contribution_margin_rate: float
    candidate_fixed_cost: float
    # --- 상단 핵심 카드 3개 ---
    min_required_sales: float           # ① 최소 필요 월매출
    required_retention: float           # ② 필요 매출 유지율
    initial_relocation_capital: float   # ③ 초기 이전 자금
    # --- 부가 ---
    net_deposit_change: float           # 후보 보증금 - 현재 보증금(추가로 묶이는 돈)
    actual_relocation_cost: float       # 회수 대상 실제 이전비용(보증금 제외)
    payback_scenarios: List[PaybackScenario] = field(default_factory=list)
    target_period_required_sales: Dict[int, float] = field(default_factory=dict)
    cumulative_profit: Dict[str, Dict[int, float]] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


# =====================================================================
#  계산 로직
# =====================================================================
DEFAULT_RETENTIONS = [1.00, 0.95, 0.90]
DEFAULT_TARGET_PERIODS = [12, 24, 36]
CUMULATIVE_HORIZONS = [12, 24, 36]


def _candidate_operating_profit(sales: float, cm_rate: float, cand_fixed: float) -> float:
    """후보 매장 월 운영손익 = 매출×공헌이익률 - 후보 고정비.
    (변동비율은 현재 매장과 동일하다고 가정 → 같은 업종 이전)"""
    return sales * cm_rate - cand_fixed


def compute(
    current: CurrentStore,
    candidate: CandidateStore,
    retentions: List[float] = None,
    target_periods: List[int] = None,
    avg_daily_sales_for_closure: Optional[float] = None,
) -> StayMoveResult:
    """STEP 4 전체 계산."""
    retentions = retentions or DEFAULT_RETENTIONS
    target_periods = target_periods or DEFAULT_TARGET_PERIODS
    warnings: List[str] = []

    cm = current.contribution_margin_rate
    cur_op = current.operating_profit
    cand_fixed = candidate.fixed_cost

    # 공헌이익률이 0 이하이면 CVP 계산 불가(변동비가 매출 이상)
    if cm <= 0:
        warnings.append("공헌이익률이 0 이하입니다 — 변동비 구조를 먼저 점검하세요. 계산 신뢰 불가.")
        cm = float("nan")

    # 휴업 손실 = 휴업일 × 일평균 운영손익(없으면 월손익÷30 추정)
    daily_profit = (avg_daily_sales_for_closure
                    if avg_daily_sales_for_closure is not None
                    else cur_op / 30.0)
    closure_loss = max(0.0, candidate.closed_days * daily_profit)

    # ── STEP 4-2. 최소 필요 월매출 ──
    #  (후보 고정비 + 현재 월 운영 후 잔여금액) ÷ 공헌이익률
    min_required_sales = (cand_fixed + cur_op) / cm if cm and cm == cm else float("nan")

    # ── STEP 4-3. 필요 매출 유지율 ──
    required_retention = (min_required_sales / current.monthly_sales
                          if current.monthly_sales else float("nan"))

    # ── STEP 4-4. 초기 이전 자금 ──
    #  보증금은 '비용'이 아니라 묶이는 자금 → 추가 보증금만 자금 소요로 반영
    net_deposit_change = candidate.deposit - current.deposit
    #  회수 대상 '실제 이전비용'은 보증금 제외(인테리어+이사+기타+휴업손실)
    actual_relocation_cost = (candidate.interior_cost + candidate.moving_cost
                              + candidate.other_moving_cost + closure_loss)
    #  화면 카드 ③ '초기 이전 자금' = 추가로 필요한 현금 = 실제이전비용 + 추가보증금
    initial_relocation_capital = actual_relocation_cost + max(0.0, net_deposit_change)

    # ── STEP 4-5. 매출 유지율별 이전비 회수기간 ──
    scenarios: List[PaybackScenario] = []
    for r in retentions:
        cand_sales = current.monthly_sales * r
        cand_op = _candidate_operating_profit(cand_sales, cm, cand_fixed) if cm == cm else float("nan")
        gain = cand_op - cur_op
        if not (gain == gain) or gain <= 0:  # NaN 또는 0 이하 → 회수 불가
            payback = None
        else:
            payback = actual_relocation_cost / gain
        scenarios.append(PaybackScenario(
            retention=r, candidate_sales=cand_sales,
            candidate_operating_profit=cand_op, monthly_gain=gain,
            payback_months=payback,
        ))

    # ── STEP 4-6. 회수 목표기간별 필요 매출(역산) ──
    #  S = (실제이전비용/개월 + 후보고정비 + 현재손익) / 공헌이익률
    target_required: Dict[int, float] = {}
    if cm == cm:
        for m in target_periods:
            target_required[m] = (actual_relocation_cost / m + cand_fixed + cur_op) / cm

    # ── 보조 시각화. 누적 손익(Stay vs Move@각 유지율) ──
    #  Move 누적 = 유지율별 후보 월손익×개월 - 실제이전비용
    #  Stay 누적 = 현재 월손익×개월
    cumulative: Dict[str, Dict[int, float]] = {}
    cumulative["stay"] = {h: cur_op * h for h in CUMULATIVE_HORIZONS}
    for r in retentions:
        cand_op = _candidate_operating_profit(current.monthly_sales * r, cm, cand_fixed) if cm == cm else float("nan")
        key = f"move_{int(r*100)}"
        cumulative[key] = {h: cand_op * h - actual_relocation_cost for h in CUMULATIVE_HORIZONS}

    return StayMoveResult(
        current_operating_profit=cur_op,
        contribution_margin_rate=cm,
        candidate_fixed_cost=cand_fixed,
        min_required_sales=min_required_sales,
        required_retention=required_retention,
        initial_relocation_capital=initial_relocation_capital,
        net_deposit_change=net_deposit_change,
        actual_relocation_cost=actual_relocation_cost,
        payback_scenarios=scenarios,
        target_period_required_sales=target_required,
        cumulative_profit=cumulative,
        warnings=warnings,
    )


# =====================================================================
#  데모 실행
# =====================================================================
if __name__ == "__main__":
    # 사용자 문서 STEP 1 예시값 그대로
    current = CurrentStore(
        monthly_sales=28_000_000,
        variable_cost=11_200_000,   # 40%
        fixed_cost=9_300_000,
        deposit=20_000_000,
    )
    candidate = CandidateStore(
        name="성수동 후보 1층",
        monthly_rent=8_000_000,
        maintenance_fee=800_000,
        other_fixed_cost=2_000_000,   # 인건비 등
        deposit=30_000_000,
        interior_cost=25_000_000,
        moving_cost=5_000_000,
        closed_days=15,
    )
    res = compute(current, candidate)

    won = lambda x: f"{x:,.0f}원"
    print("현재 월 운영손익 :", won(current.operating_profit))
    print("공헌이익률       :", f"{res.contribution_margin_rate:.1%}")
    print("① 최소 필요 월매출:", won(res.min_required_sales))
    print("② 필요 매출 유지율:", f"{res.required_retention:.1%}")
    print("③ 초기 이전 자금  :", won(res.initial_relocation_capital),
          f"(추가보증금 {won(res.net_deposit_change)} 포함)")
    print("\n[매출 유지율별 회수기간]")
    for s in res.payback_scenarios:
        pm = f"{s.payback_months:.1f}개월" if s.payback_months else "회수 어려움"
        print(f"  유지율 {s.retention:.0%}: 월개선 {won(s.monthly_gain)} → {pm}")
    print("\n[목표기간별 필요 매출]")
    for m, s in res.target_period_required_sales.items():
        print(f"  {m}개월 내 회수: {won(s)}")
