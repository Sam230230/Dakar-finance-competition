// 온보딩 화면 전용 상태/표시 로직.
// 실제 판단 계산(Rule/ML/RAG/AI)은 전부 백엔드가 하고, 여기서는
// 입력 중에 좌측 프리뷰 패널에 보여줄 값만 가볍게 계산한다.

export const labels = ["A", "B", "C"];

export function blankState() {
  return {
    demoScenario: null,
    current: {
      address: "", sales: null, variable: null,
      rent: null, labor: null, mgmt: null, fixed: null,
      cash: null, depositReturn: null, keyMoneyRecovery: null
    },
    candidateCount: null,
    candidates: [],
    recoveryMonths: null
  };
}

export function emptyCandidate() {
  return {
    address: "", rent: null, management: null, otherFixed: null, deposit: null,
    interior: null, moving: null, restoration: null, rights: null, otherMove: null, closedDays: null
  };
}

export const money = n => Math.round(Number(n || 0)).toLocaleString("ko-KR") + "만원";

export function monthly(c) {
  return Number(c.rent || 0) + Number(c.management || 0) + Number(c.otherFixed || 0);
}

// 회수기간을 추가로 물어볼지 판단하는 기준.
// 후보 월 운영비가 현재 고정비보다 낮거나 같으면 "얼마 만에 회수할지"가 의미 있는 질문이 된다.
export function lowerOrEqualCandidates(state) {
  return state.candidates.filter(c => monthly(c) <= Number(state.current.fixed || 0));
}

export function scenario(n) {
  // 최신 데이터 — 2026-09-02 jc1004.co.kr 양도양수 매물(투썸플레이스) 기준.
  // 현재 강동구(427239), 후보는 송파구(427240) 은평구(427238) 금천구(427209).
  // 주소는 매물 소재지의 도로명까지다. 상세 지번은 매물 특성상 비공개라 건물 단위에서 멈춘다 —
  // 상권(TRDAR)은 한 변이 수백 m라 이 정도면 어느 상권인지 정해진다.
  // 월 변동비는 월지출에서 고정비를 뺀 값이고, 고정비 항목별 배분과 가용현금은 추정치다.
  if (n === 0) {
    return {
      demoScenario: 0,
      current: {
        address: "서울 강동구 천호대로 1037",
        sales: 5200, variable: 3600,
        rent: 300, labor: 200, mgmt: 50, fixed: 550,
        cash: 5000, depositReturn: 10000, keyMoneyRecovery: 21000
      },
      candidateCount: 3,
      candidates: [
        { address: "서울 송파구 송파대로 437", rent: 270, management: 70, otherFixed: 110, deposit: 7000, interior: 1300, moving: 250, restoration: 700, rights: 19000, otherMove: 100, closedDays: 10 },
        { address: "서울 은평구 연서로 223 2", rent: 300, management: 75, otherFixed: 125, deposit: 8000, interior: 1200, moving: 250, restoration: 700, rights: 16000, otherMove: 100, closedDays: 10 },
        { address: "서울 금천구 시흥대로 228", rent: 600, management: 150, otherFixed: 250, deposit: 12000, interior: 750, moving: 250, restoration: 700, rights: 3000, otherMove: 100, closedDays: 10 }
      ],
      recoveryMonths: null
    };
  }
  // 시나리오 1·2는 예시값이다. 주소는 원래 동을 대표하는 실제 도로명으로 적는다 —
  // 상권은 한 변이 수백 m라 동 단위 주소로는 어느 상권인지 정해지지 않기 때문.
  if (n === 1) {
    return {
      demoScenario: 1,
      current: {
        address: "서울 마포구 동교로 262",
        sales: 2800, variable: 980,
        rent: 700, labor: 200, mgmt: 150, fixed: 1050,
        cash: 1500, depositReturn: 2700, keyMoneyRecovery: 0
      },
      candidateCount: 3,
      candidates: [
        { address: "서울 강남구 테헤란로 152", rent: 1150, management: 120, otherFixed: 100, deposit: 5000, interior: 1800, moving: 150, restoration: 300, rights: 500, otherMove: 100, closedDays: 7 },
        { address: "서울 성동구 아차산로 100", rent: 1050, management: 100, otherFixed: 80, deposit: 4500, interior: 1600, moving: 150, restoration: 300, rights: 400, otherMove: 100, closedDays: 6 },
        { address: "서울 마포구 월드컵로 76", rent: 980, management: 100, otherFixed: 70, deposit: 4000, interior: 1400, moving: 120, restoration: 250, rights: 300, otherMove: 80, closedDays: 5 }
      ],
      recoveryMonths: null
    };
  }
  return {
    demoScenario: 2,
    current: {
      address: "서울 마포구 동교로 262",
      sales: 2800, variable: 980,
      rent: 800, labor: 250, mgmt: 150, fixed: 1200,
      cash: 1200, depositReturn: 2700, keyMoneyRecovery: 0
    },
    candidateCount: 3,
    candidates: [
      { address: "서울 마포구 월드컵로 76", rent: 700, management: 90, otherFixed: 60, deposit: 3000, interior: 1200, moving: 120, restoration: 250, rights: 200, otherMove: 80, closedDays: 5 },
      { address: "서울 관악구 남부순환로 1820", rent: 620, management: 80, otherFixed: 50, deposit: 2500, interior: 1100, moving: 100, restoration: 250, rights: 150, otherMove: 70, closedDays: 5 },
      { address: "서울 은평구 응암로 175", rent: 580, management: 70, otherFixed: 50, deposit: 2000, interior: 1000, moving: 100, restoration: 220, rights: 100, otherMove: 60, closedDays: 4 }
    ],
    recoveryMonths: null
  };
}

/**
 * 온보딩 상태를 백엔드 /staymove 페이로드로 변환한다.
 *
 보증금과 권리금 처리(중요):
 *   백엔드 current.deposit 은 "현재 보증금 — 회수되어 후보 보증금에 재투입 가능"을 뜻하고
 *   net_deposit_change = 후보 보증금 − 현재 보증금 으로 쓰인다.
 *   온보딩에서는 이를 사용자가 답하기 쉬운 "보증금 반환 예상액"(밀린 임대료와 원상복구비를 뺀 순액)으로
 *   바꿔 묻고, "권리금 회수"를 별도 칸으로 추가했다.
 *
 *   ── B안 적용 (팀 결정) ─────────────────────────────────────────
 *   권리금은 available_self_fund 에 합산하지 않는다. 현금만 보낸다.
 *
 *   백엔드의 self_fund 는 "통장에 있는 확정 현금"을 전제로 쓰이는데, 권리금은
 *   새 임차인이 나타나야 받는 돈이라 확정이 아니다. 합산하면 자금이 덜 필요하다고
 *   나와서 "이만하면 되겠다"는 낙관적 오판을 부른다.
 *
 *   남는 오차는 하나뿐이고 방향이 보수적이다.
 *     ① 순액을 계약서상 금액 자리에 넣어 net_deposit_change가 과대 → 자금이 더 필요하다고 나옴
 *
 *   권리금 입력값은 state에 그대로 남겨둔다. 백엔드가 필드를 나눠 받게 되면(C안)
 *   이 어댑터만 고쳐서 바로 쓸 수 있다.
 *   숫자 예시와 C안 설계는 web/README.md 참고.
 */
export function toStayMovePayload(state, { candidates, recoveryMonths, trdarByIndex = {} }) {
  const num = v => Number(v || 0);
  const cur = state.current;

  return {
    business_name: "우리 매장",
    industry: "커피-음료",
    industry_code: "CS100010",
    current: {
      address: cur.address,
      monthly_sales: num(cur.sales),
      variable_cost: num(cur.variable),
      fixed_cost: num(cur.fixed),
      // 보증금 반환 예상액을 현재 보증금 자리에 넣는다(위 주석 참고)
      deposit: num(cur.depositReturn),
      // B안: 권리금은 확정 현금이 아니므로 합산하지 않고 현금만 보낸다.
      // 값 자체는 state(cur.keyMoneyRecovery)에 그대로 살아 있다 — 지우지 말 것.
      // 백엔드가 필드를 받게 되면(C안) 아래 한 줄만 살리면 된다:
      //   key_money_recovery: num(cur.keyMoneyRecovery),
      available_self_fund: num(cur.cash)
    },
    target_recovery_months: recoveryMonths != null ? Number(recoveryMonths) : null,
    candidates: candidates.map((c, i) => ({
      site_id: labels[i],
      name: c.address,
      trdar_cd: trdarByIndex[i] || null,
      monthly_rent: num(c.rent),
      maintenance_fee: num(c.management),
      other_fixed_cost: num(c.otherFixed),
      deposit: num(c.deposit),
      interior_cost: num(c.interior),
      moving_cost: num(c.moving),
      restoration_cost: num(c.restoration),
      rights_fee: num(c.rights),
      other_moving_cost: num(c.otherMove),
      closed_days: num(c.closedDays)
    }))
  };
}
