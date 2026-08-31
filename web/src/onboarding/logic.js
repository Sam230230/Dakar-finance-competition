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
  if (n === 1) {
    return {
      demoScenario: 1,
      current: {
        address: "서울 마포구 연남동",
        sales: 2800, variable: 980,
        rent: 700, labor: 200, mgmt: 150, fixed: 1050,
        cash: 1500, depositReturn: 2700, keyMoneyRecovery: 0
      },
      candidateCount: 3,
      candidates: [
        { address: "서울 강남구 역삼동", rent: 1150, management: 120, otherFixed: 100, deposit: 5000, interior: 1800, moving: 150, restoration: 300, rights: 500, otherMove: 100, closedDays: 7 },
        { address: "서울 성동구 성수동", rent: 1050, management: 100, otherFixed: 80, deposit: 4500, interior: 1600, moving: 150, restoration: 300, rights: 400, otherMove: 100, closedDays: 6 },
        { address: "서울 마포구 망원동", rent: 980, management: 100, otherFixed: 70, deposit: 4000, interior: 1400, moving: 120, restoration: 250, rights: 300, otherMove: 80, closedDays: 5 }
      ],
      recoveryMonths: null
    };
  }
  return {
    demoScenario: 2,
    current: {
      address: "서울 마포구 연남동",
      sales: 2800, variable: 980,
      rent: 800, labor: 250, mgmt: 150, fixed: 1200,
      cash: 1200, depositReturn: 2700, keyMoneyRecovery: 0
    },
    candidateCount: 3,
    candidates: [
      { address: "서울 마포구 망원동", rent: 700, management: 90, otherFixed: 60, deposit: 3000, interior: 1200, moving: 120, restoration: 250, rights: 200, otherMove: 80, closedDays: 5 },
      { address: "서울 관악구 봉천동", rent: 620, management: 80, otherFixed: 50, deposit: 2500, interior: 1100, moving: 100, restoration: 250, rights: 150, otherMove: 70, closedDays: 5 },
      { address: "서울 은평구 응암동", rent: 580, management: 70, otherFixed: 50, deposit: 2000, interior: 1000, moving: 100, restoration: 220, rights: 100, otherMove: 60, closedDays: 4 }
    ],
    recoveryMonths: null
  };
}

/**
 * 온보딩 상태를 백엔드 /staymove 페이로드로 변환한다.
 *
 * 보증금·권리금 처리(중요):
 *   백엔드 current.deposit 은 "현재 보증금 — 회수되어 후보 보증금에 재투입 가능"을 뜻하고
 *   net_deposit_change = 후보 보증금 − 현재 보증금 으로 쓰인다.
 *   온보딩에서는 이를 사용자가 답하기 쉬운 "보증금 반환 예상액"(밀린 임대료·원상복구비를 뺀 순액)으로 바꿔 묻고,
 *   "권리금 회수"를 별도 칸으로 추가했다. 백엔드에는 권리금 회수에 대응하는 필드가 없으므로
 *   권리금은 available_self_fund(가용 자기자금)에 더해서 보낸다.
 *
 *   ⚠️ 두 오차의 방향이 반대다.
 *     ① 순액을 계약서상 금액 자리에 넣어 net_deposit_change가 과대 → 보수적(안전)
 *     ② 권리금을 확정 현금처럼 합산 → 자금이 덜 필요하다고 나올 수 있음(낙관 위험)
 *   특히 ②는 권리금을 크게 잡은 사용자일수록 영향이 커진다.
 *   숫자 예시와 정확히 고치는 방법은 web/README.md 참고.
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
      // 권리금 회수 예상액은 대응 필드가 없어 자기자금에 합산한다
      available_self_fund: num(cur.cash) + num(cur.keyMoneyRecovery)
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
