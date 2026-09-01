import React from "react";
import ReactDOM from "react-dom/client";
import CodexResultScreen from "./CodexResultScreen.jsx";
import "./codex-result.css";

const candidates = [
  {
    site_id: "A",
    name: "성수동 연무장길",
    analysis_mode: "growth_opportunity",
    monthly_operating_cost: 620,
    monthly_cost_delta: 110,
    min_required_sales: 3292,
    initial_capital: 7200,
    available_self_fund: 5000,
    additional_fund_needed: 2200,
    net_deposit_change: 3000,
    actual_relocation_cost: 4200,
    target_months: 24,
    target_periods: [
      { months: 12, required_sales: 3770 },
      { months: 24, required_sales: 3470, selected: true },
      { months: 36, required_sales: 3370 },
    ],
    scenarios: [{ retention: 1, candidate_sales: 2800, monthly_gain: 115, payback_months: 36.5 }],
    ml: { predicted_monthly_sales: 3580 },
    market_observed: {
      close_rate: 7.1, sales_yoy: 8.4, sales_trend: "상승", sales_trend_pct: 6.8,
      sales_history_grain: "district",
      sales_history: [
        { quarter: 202401, monthly_sales: 2860 }, { quarter: 202402, monthly_sales: 2920 },
        { quarter: 202403, monthly_sales: 2890 }, { quarter: 202404, monthly_sales: 3010 },
        { quarter: 202501, monthly_sales: 3060 }, { quarter: 202502, monthly_sales: 3130 },
        { quarter: 202503, monthly_sales: 3190 }, { quarter: 202504, monthly_sales: 3260 },
      ],
    },
    policy_rag: { results: [
      { title: "서울시 소상공인 중소기업육성기금", status: "접수 중", summary: "시설 개선과 이전 비용에 활용할 수 있는 융자예요." },
      { title: "성동구 소상공인 특별보증", status: "자격 확인", summary: "사업장 이전 뒤 소재지 조건을 확인해야 해요." },
    ] },
  },
  {
    site_id: "B",
    name: "망원동 포은로",
    analysis_mode: "cost_recovery",
    monthly_operating_cost: 470,
    monthly_cost_delta: -40,
    min_required_sales: 2860,
    initial_capital: 5400,
    available_self_fund: 5000,
    additional_fund_needed: 400,
    net_deposit_change: 2200,
    actual_relocation_cost: 3200,
    target_months: 24,
    target_periods: [
      { months: 12, required_sales: 3210 },
      { months: 24, required_sales: 3010, selected: true },
      { months: 36, required_sales: 2940 },
    ],
    scenarios: [{ retention: 1, candidate_sales: 2800, monthly_gain: 162, payback_months: 23.4 }],
    ml: { predicted_monthly_sales: 3120 },
    market_observed: {
      close_rate: 8.9, sales_yoy: 3.2, sales_trend: "보합", sales_trend_pct: 1.1,
      sales_history_grain: "district",
      sales_history: [
        { quarter: 202401, monthly_sales: 2710 }, { quarter: 202402, monthly_sales: 2760 },
        { quarter: 202403, monthly_sales: 2740 }, { quarter: 202404, monthly_sales: 2800 },
        { quarter: 202501, monthly_sales: 2780 }, { quarter: 202502, monthly_sales: 2830 },
        { quarter: 202503, monthly_sales: 2840 }, { quarter: 202504, monthly_sales: 2860 },
      ],
    },
    policy_rag: { results: [{ title: "마포구 소상공인 특별보증", status: "접수 중", summary: "운전자금과 시설자금 용도를 확인할 수 있어요." }] },
  },
  {
    site_id: "C",
    name: "문래동 도림로",
    analysis_mode: "cost_recovery",
    monthly_operating_cost: 430,
    monthly_cost_delta: -80,
    min_required_sales: 2760,
    initial_capital: 6100,
    available_self_fund: 5000,
    additional_fund_needed: 1100,
    net_deposit_change: 2700,
    actual_relocation_cost: 3400,
    target_months: 24,
    target_periods: [
      { months: 12, required_sales: 3150 },
      { months: 24, required_sales: 2930, selected: true },
      { months: 36, required_sales: 2860 },
    ],
    scenarios: [{ retention: 1, candidate_sales: 2800, monthly_gain: 184, payback_months: 27.2 }],
    ml: { predicted_monthly_sales: 2820 },
    market_observed: {
      close_rate: 6.8, sales_yoy: -1.7, sales_trend: "하락", sales_trend_pct: -2.4,
      sales_history_grain: "district",
      sales_history: [
        { quarter: 202401, monthly_sales: 2960 }, { quarter: 202402, monthly_sales: 2910 },
        { quarter: 202403, monthly_sales: 2940 }, { quarter: 202404, monthly_sales: 2870 },
        { quarter: 202501, monthly_sales: 2820 }, { quarter: 202502, monthly_sales: 2790 },
        { quarter: 202503, monthly_sales: 2750 }, { quarter: 202504, monthly_sales: 2700 },
      ],
    },
    policy_rag: { results: [] },
  },
];

const previewData = {
  current_monthly_sales: 2800,
  current_monthly_fixed_cost: 510,
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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <CodexResultScreen data={previewData} onRestart={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
  </React.StrictMode>,
);
