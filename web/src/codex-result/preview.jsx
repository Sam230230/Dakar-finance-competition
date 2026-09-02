import React from "react";
import ReactDOM from "react-dom/client";
import CodexResultScreen from "./CodexResultScreen.jsx";
import "./codex-result.css";

const candidates = [
  {
    site_id: "A",
    ai_explanation: {
      mode: "llm",
      one_line_summary: "매출 여력은 가장 크지만, 시작할 때 목돈이 가장 많이 드는 후보예요.",
      strengths: ["예상매출이 최소 필요매출을 8.7% 웃돌아요.", "상권 매출이 분기마다 오르는 흐름이에요."],
      risks: ["추가로 2,200만원을 더 마련해야 해요.", "매장 유지비가 지금보다 295만원 늘어요."],
      decision_condition: "이전 첫해에 예상매출의 90% 이상을 실제로 낼 수 있어야 해요.",
      candidate_interpretation: "성장 여력을 사는 대신 초기 부담을 지는 자리예요. 자금 조달이 확정된 뒤에 결정하는 게 안전해요.",
      important_checks: ["보증금 3,000만원의 반환 조건을 계약서에서 확인하세요.", "인테리어 견적이 2,500만원 안에서 끝나는지 확인하세요."],
    },
    name: "성수동 연무장길",
    candidate_region: "성동구",
    analysis_mode: "growth_opportunity",
    monthly_operating_cost: 1225,
    monthly_cost_delta: 295,
    min_required_sales: 3292,
    initial_capital: 7200,
    available_self_fund: 5000,
    additional_fund_needed: 2200,
    net_deposit_change: 3000,
    actual_relocation_cost: 4200,
    relocation_cost_items: [
      { label: "인테리어", amount: 2500 }, { label: "이사", amount: 600 },
      { label: "원상복구", amount: 400 }, { label: "권리금", amount: 0 },
      { label: "기타", amount: 200 }, { label: "휴업 15일", amount: 500 },
    ],
    operating_cost_items: [
      { label: "월세", amount: 380 }, { label: "관리비", amount: 60 }, { label: "기타 고정비", amount: 180 },
    ],
    candidate_fixed_cost: 1225,
    target_months: 24,
    target_periods: [
      { months: 12, required_sales: 3770 },
      { months: 24, required_sales: 3470, selected: true },
      { months: 36, required_sales: 3370 },
    ],
    scenarios: [{ retention: 1, candidate_sales: 2800, monthly_gain: 115, payback_months: 36.5 }],
    ml: {
      status: "ok", predicted_monthly_sales: 3580, model_source: "real", model_name: "LightGBM",
      data_completeness: "trdar_exact", basis_quarter: 20261, target_quarter: 20262, prediction_outlier: false,
      predicted_district_sales: 2293780,
    },
    market_observed: {
      close_rate: 7.1, sales_yoy: 8.4, sales_trend: "상승", sales_trend_pct: 6.8,
      store_count: 96, franchise_count: 11, franchise_share: 11.5, change_index: 0.58, competition_grain: "trdar",
      flow_pop_history: [{quarter:20242,daily:527100},{quarter:20243,daily:519800},{quarter:20244,daily:524600},{quarter:20251,daily:518200},{quarter:20252,daily:514900},{quarter:20253,daily:511300},{quarter:20254,daily:510700},{quarter:20261,daily:512340}],
      flow_pop_daily: 512340, flow_pop_qoq_pct: 0.3, flow_pop_grain: "district",
      sales_history_grain: "district",
      sales_history: [
        { quarter: 20242, monthly_sales: 2269184 }, { quarter: 20243, monthly_sales: 2110170 },
        { quarter: 20244, monthly_sales: 2124960 }, { quarter: 20251, monthly_sales: 1907025 },
        { quarter: 20252, monthly_sales: 2183464 }, { quarter: 20253, monthly_sales: 2148703 },
        { quarter: 20254, monthly_sales: 2076318 }, { quarter: 20261, monthly_sales: 2013561 },
      ],
    },
    policy_rag: { fund_priority: "normal", results: [
      {
        name: "2026년 서울시 중소기업육성자금 - 시설자금", region_slot: "서울 공통", region_scope: "서울특별시",
        agency: "서울신용보증재단", target: "서울 소재 중소기업과 소상공인의 시설 투자에 필요한 자금을 지원해요.",
        support_type: "융자", fund_use: "facility (시설자금)", amount_limit: "시행규칙 별표3 기준", interest_rate: "연 2.8%",
        business_age_requirement: "확인 필요", application_status: "예산 소진 여부 확인 필요", eligibility_needs_check: true,
        eligibility_note: "자격 추가 확인 필요", url: "",
      },
      {
        name: "성동구 소상공인 특별보증", region_slot: "성동구", region_scope: "성동구",
        agency: "성동구", target: "성동구에 사업장을 둔 소상공인의 경영안정 자금 조달을 지원해요.",
        support_type: "보증", fund_use: "working_capital (경영안정 및 운전자금)", amount_limit: "공고 확인 필요", interest_rate: "확인 필요",
        business_age_requirement: "확인 필요", application_status: "신청기간 확인 필요", eligibility_needs_check: true,
        eligibility_note: "이전 후 지역 사업기간 요건 확인 필요", url: "",
      },
    ] },
  },
  {
    site_id: "B",
    ai_explanation: {
      mode: "llm",
      one_line_summary: "필요한 매출 상승 폭과 추가 자금이 모두 가장 작은 후보예요.",
      strengths: ["추가로 마련할 돈이 400만원으로 가장 적어요.", "필요한 매출 상승 폭이 2.1%로 작아요."],
      risks: ["상권 매출이 보합이라 성장은 기대하기 어려워요.", "같은 업종 점포가 119곳으로 가장 빽빽해요."],
      decision_condition: "현재 매출의 91%만 유지해도 지금과 같은 수익이 나요.",
      candidate_interpretation: "크게 벌기보다 지금을 지키는 선택이에요. 자금 부담이 작아 되돌리기도 쉬워요.",
      important_checks: ["권리금 없이 계약이 가능한지 확인하세요."],
    },
    name: "망원동 포은로",
    candidate_region: "마포구",
    analysis_mode: "cost_recovery",
    monthly_operating_cost: 966,
    monthly_cost_delta: 36,
    min_required_sales: 2860,
    initial_capital: 5400,
    available_self_fund: 5000,
    additional_fund_needed: 400,
    net_deposit_change: 2200,
    actual_relocation_cost: 3200,
    relocation_cost_items: [
      { label: "인테리어", amount: 1800 }, { label: "이사", amount: 500 },
      { label: "원상복구", amount: 350 }, { label: "권리금", amount: 0 },
      { label: "기타", amount: 150 }, { label: "휴업 12일", amount: 400 },
    ],
    operating_cost_items: [
      { label: "월세", amount: 290 }, { label: "관리비", amount: 45 }, { label: "기타 고정비", amount: 135 },
    ],
    candidate_fixed_cost: 966,
    target_months: 24,
    target_periods: [
      { months: 12, required_sales: 3210 },
      { months: 24, required_sales: 3010, selected: true },
      { months: 36, required_sales: 2940 },
    ],
    scenarios: [{ retention: 1, candidate_sales: 2800, monthly_gain: 162, payback_months: 23.4 }],
    ml: {
      status: "ok", predicted_monthly_sales: 3120, model_source: "real", model_name: "LightGBM",
      data_completeness: "trdar_exact", basis_quarter: 20261, target_quarter: 20262, prediction_outlier: false,
      predicted_district_sales: 6008155,
    },
    market_observed: {
      close_rate: 8.9, sales_yoy: 3.2, sales_trend: "보합", sales_trend_pct: 1.1,
      store_count: 119, franchise_count: 9, franchise_share: 7.6, change_index: 0.34, competition_grain: "trdar",
      flow_pop_history: [{quarter:20242,daily:767999},{quarter:20243,daily:750025},{quarter:20244,daily:759001},{quarter:20251,daily:751090},{quarter:20252,daily:744813},{quarter:20253,daily:743092},{quarter:20254,daily:743092},{quarter:20261,daily:744376}],
      flow_pop_daily: 744376, flow_pop_qoq_pct: 0.2, flow_pop_grain: "district",
      sales_history_grain: "district",
      sales_history: [
        { quarter: 20242, monthly_sales: 6997052 }, { quarter: 20243, monthly_sales: 6771642 },
        { quarter: 20244, monthly_sales: 6322674 }, { quarter: 20251, monthly_sales: 5760843 },
        { quarter: 20252, monthly_sales: 6340823 }, { quarter: 20253, monthly_sales: 6567858 },
        { quarter: 20254, monthly_sales: 5991067 }, { quarter: 20261, monthly_sales: 5713530 },
      ],
    },
    policy_rag: { fund_priority: "normal", results: [
      {
        name: "2026년 서울시 중소기업육성자금 - 창업기업자금", region_slot: "서울 공통", region_scope: "서울특별시",
        agency: "서울신용보증재단", target: "서울 소재 창업기업의 초기 경영안정과 운전자금 확보를 지원해요.",
        support_type: "융자", fund_use: "working_capital (경영안정 및 운전자금)", amount_limit: "1억원 이내(일반 5천만원/특화 7천만원/임차 5천만원)", interest_rate: "이차보전 1.8%(대출일로부터 4년 이내)",
        business_age_requirement: "창업 후 1년 이내", application_status: "예산 소진 여부 확인 필요", eligibility_needs_check: true,
        eligibility_note: "자격 추가 확인 필요", url: "",
      },
      {
        name: "2026년 서울시 중소기업육성자금 - 신속드림자금", region_slot: "서울 공통", region_scope: "서울특별시",
        agency: "서울신용보증재단", target: "신속한 자금 지원으로 초기 운영비 부담을 줄일 수 있어요.",
        support_type: "융자", fund_use: "working_capital (경영안정 및 운전자금)", amount_limit: "3천만원 이내", interest_rate: "이차보전 1.8%(대출일로부터 4년 이내)",
        business_age_requirement: "확인 필요", application_status: "예산 소진 여부 확인 필요", eligibility_needs_check: true,
        eligibility_note: "자격 추가 확인 필요", url: "",
      },
      {
        name: "2026년 서울시 중소기업육성자금 - 시설자금", region_slot: "서울 공통", region_scope: "서울특별시",
        agency: "서울신용보증재단", target: "시설 투자에 필요한 자금을 지원받을 수 있어요.",
        support_type: "융자", fund_use: "facility (시설자금)", amount_limit: "시행규칙 별표3 기준", interest_rate: "연 2.8%",
        business_age_requirement: "확인 필요", application_status: "예산 소진 여부 확인 필요", eligibility_needs_check: true,
        eligibility_note: "자격 추가 확인 필요", url: "",
      },
    ] },
  },
  {
    site_id: "C",
    ai_explanation: {
      mode: "llm",
      one_line_summary: "운영비는 가장 낮지만 상권 흐름이 꺾이고 있어 여유가 얇아요.",
      strengths: ["월 운영비가 세 후보 중 가장 낮아요."],
      risks: ["예상 여유가 2.2%에 그쳐 작은 변동에도 흔들려요.", "상권 매출이 분기마다 내리는 흐름이에요."],
      decision_condition: "상권 매출 하락이 멈췄다는 근거를 직접 확인해야 해요.",
      candidate_interpretation: "비용은 줄지만 매출이 함께 줄어들 위험이 남아 있어요. 목표 회수기간을 못 맞출 가능성이 커요.",
      important_checks: ["최근 6개월 주변 폐업 현황을 직접 확인하세요.", "유동인구가 실제로 매출로 이어지는 시간대인지 확인하세요."],
    },
    name: "문래동 도림로",
    candidate_region: "영등포구",
    analysis_mode: "cost_recovery",
    monthly_operating_cost: 906,
    monthly_cost_delta: -24,
    min_required_sales: 2760,
    initial_capital: 6100,
    available_self_fund: 5000,
    additional_fund_needed: 1100,
    net_deposit_change: 2700,
    actual_relocation_cost: 3400,
    relocation_cost_items: [
      { label: "인테리어", amount: 2000 }, { label: "이사", amount: 450 },
      { label: "원상복구", amount: 300 }, { label: "권리금", amount: 300 },
      { label: "기타", amount: 0 }, { label: "휴업 10일", amount: 350 },
    ],
    operating_cost_items: [
      { label: "월세", amount: 260 }, { label: "관리비", amount: 50 }, { label: "기타 고정비", amount: 120 },
    ],
    candidate_fixed_cost: 906,
    target_months: 24,
    target_periods: [
      { months: 12, required_sales: 3150 },
      { months: 24, required_sales: 2930, selected: true },
      { months: 36, required_sales: 2860 },
    ],
    scenarios: [{ retention: 1, candidate_sales: 2800, monthly_gain: 184, payback_months: 27.2 }],
    ml: {
      status: "ok", predicted_monthly_sales: 2820, model_source: "real", model_name: "LightGBM",
      data_completeness: "district_fallback", basis_quarter: 20261, target_quarter: 20262, prediction_outlier: false,
      predicted_district_sales: 5078056,
    },
    market_observed: {
      close_rate: 6.8, sales_yoy: -1.7, sales_trend: "하락", sales_trend_pct: -2.4,
      store_count: 74, franchise_count: 6, franchise_share: 8.1, change_index: 0.76, competition_grain: "trdar",
      flow_pop_history: [{quarter:20242,daily:767999},{quarter:20243,daily:750025},{quarter:20244,daily:759001},{quarter:20251,daily:751090},{quarter:20252,daily:744813},{quarter:20253,daily:743092},{quarter:20254,daily:743092},{quarter:20261,daily:744376}],
      flow_pop_daily: 744376, flow_pop_qoq_pct: 0.2, flow_pop_grain: "district",
      sales_history_grain: "district",
      sales_history: [
        { quarter: 20242, monthly_sales: 4424789 }, { quarter: 20243, monthly_sales: 4457993 },
        { quarter: 20244, monthly_sales: 4497511 }, { quarter: 20251, monthly_sales: 4180593 },
        { quarter: 20252, monthly_sales: 4624332 }, { quarter: 20253, monthly_sales: 5015495 },
        { quarter: 20254, monthly_sales: 4667358 }, { quarter: 20261, monthly_sales: 4583539 },
      ],
    },
    policy_rag: { fund_priority: "normal", results: [] },
  },
];

const previewData = {
  current_monthly_sales: 2800,
  current_operating_profit: 750,
  contribution_margin_rate: 0.6,
  current_monthly_fixed_cost: 930,   // 매출 2800 - 변동비 1120 - 영업이익 750
  current_available_self_fund: 5000,
  target_recovery_months: 24,
  candidates,
  ranking: {
    ranking: ["B", "A", "C"],
    recommended_candidate: "B",
    confidence: "strong",
    viable: { A: true, B: true, C: true },
    reasons: {
      A: { sales_buffer_ratio: 0.087, additional_fund_needed: 2200, meets_recovery_target: true },
      B: { sales_buffer_ratio: 0.091, additional_fund_needed: 400, meets_recovery_target: true },
      C: { sales_buffer_ratio: 0.022, additional_fund_needed: 1100, meets_recovery_target: false },
    },
  },
  overall: {
    headline: "지금 조건에서는 후보 B가 가장 현실적이에요.",
    main_risk: "예상 매출이 현재보다 높지만 여유 폭이 크지는 않아요.",
  },
  comparison_summary: "후보 B는 필요한 매출 상승 폭과 추가 자금이 가장 작아요. 후보 A는 매출 여력이 있지만 초기 자금 부담이 크고, 후보 C는 상권 흐름을 더 확인해야 해요.",
};

// App.jsx 의 resolvePlace 가 만드는 모양과 같은 좌표 묶음 — 지도와 상권명 라벨용.
const previewPlaces = {
  current: { site_id: "current", label: "현재 매장", lat: 37.54934177, lng: 126.9129994, trdar_cd: "3120101", trdar_nm: "합정역" },
  A: { site_id: "A", label: "후보 A", lat: 37.5445, lng: 127.0557, trdar_cd: "3001492", trdar_nm: "성수동 카페거리" },
  B: { site_id: "B", label: "후보 B", lat: 37.5567129, lng: 126.9024385, trdar_cd: "3110544", trdar_nm: "망리단길" },
  C: { site_id: "C", label: "후보 C", lat: 37.5175, lng: 126.895, trdar_cd: "3110982", trdar_nm: "문래동 거리" },
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <CodexResultScreen
      data={previewData}
      places={previewPlaces}
      aiState="done"
      onRestart={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    />
  </React.StrictMode>,
);
