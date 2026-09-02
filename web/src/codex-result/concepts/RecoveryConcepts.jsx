import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { CalendarCheck2, Check, PanelsTopLeft, TrendingUp } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Dot, Label, LabelList, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./recovery-concepts.css";

const MAINTENANCE = 2860;
const RELOCATION_COST = 5328;
const ML_EXPECTED = 3120;
const PERIODS = [6, 12, 24, 36, 48, 60];
const CARD_PERIODS = [12, 24, 36, 48];

const requiredSales = (months) => Math.round(MAINTENANCE + RELOCATION_COST / months);
const won = (value) => `${Math.round(value).toLocaleString("ko-KR")}만원`;

function SegmentTabs({ active, onChange }) {
  const tabs = [
    { id: "direct", label: "입력값 반영", icon: CalendarCheck2 },
    { id: "cards", label: "기간 비교", icon: PanelsTopLeft },
    { id: "cashflow", label: "누적 회수", icon: TrendingUp },
  ];

  return (
    <nav className="rc-tabs" aria-label="회수기간 그래프 시안">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" className={active === id ? "is-active" : ""} onClick={() => onChange(id)} aria-pressed={active === id}>
          <Icon aria-hidden="true" size={18} strokeWidth={2.2} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function MetricPair({ months }) {
  return (
    <div className="rc-metrics" aria-live="polite">
      <div><span>회수 목표기간</span><strong>{months}개월</strong></div>
      <div><span>매달 필요한 매출</span><strong>{won(requiredSales(months))}</strong></div>
    </div>
  );
}

function RecoveryPointLabel({ viewBox, x, y, months, sales }) {
  const pointX = viewBox?.x ?? x;
  const pointY = viewBox?.y ?? y;
  if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) return null;

  return (
    <g transform={`translate(${pointX - 78} ${pointY - 70})`}>
      <rect width="156" height="54" rx="9" fill="#121619" />
      <text x="14" y="22" fill="#cdd1ce" fontSize="11" fontWeight="650">온보딩 입력 {months}개월</text>
      <text x="14" y="42" fill="#ffffff" fontSize="15" fontWeight="800">월 {won(sales)}</text>
    </g>
  );
}

function RecoverySeriesDot({ cx, cy, payload, selectedMonth }) {
  if (payload?.month !== selectedMonth) return null;
  return <Dot cx={cx} cy={cy} r={6} fill="#377538" stroke="#ffffff" strokeWidth={2} />;
}

function RecoverySeriesLabel({ x, y, index, selectedIndex, selectedMonth, sales }) {
  if (index !== selectedIndex) return null;
  return <RecoveryPointLabel x={x} y={y} months={selectedMonth} sales={sales} />;
}

function RecoveryMonthTick({ x, y, payload, selectedMonth }) {
  const isSelected = payload?.value === selectedMonth;
  return (
    <g transform={`translate(${x} ${y})`}>
      {isSelected && <rect x="-27" y="6" width="54" height="25" rx="7" fill="#121619" />}
      <text x="0" y="23" textAnchor="middle" fill={isSelected ? "#ffffff" : "#64696e"} fontSize="12" fontWeight={isSelected ? 800 : 650}>
        {payload?.value}개월
      </text>
    </g>
  );
}

function RecoveryTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const sales = payload[0]?.value;
  return (
    <div className="rc-recharts-tooltip">
      <span>{label}개월 회수 기준</span>
      <strong>월 {won(sales)}</strong>
    </div>
  );
}

function DirectChart({ months }) {
  const salesTicks = [2800, 3000, 3200, 3400, 3600, 3800];
  const chartData = Array.from({ length: 55 }, (_, index) => {
    const month = index + 6;
    return { month, sales: requiredSales(month) };
  });
  const selectedSales = requiredSales(months);

  return (
    <section className="rc-panel" aria-labelledby="direct-title">
      <div className="rc-panel-head">
        <div><span className="rc-label">입력값 반영형</span><h2 id="direct-title">앞에서 정한 회수기간을 그래프로 확인해요</h2><p>온보딩에서 선택한 기간과 그에 따른 필요 월매출만 보여줘요.</p></div>
        <MetricPair months={months} />
      </div>
      <div className="rc-recharts" role="img" aria-label={`${months}개월 안에 회수하려면 매달 ${won(selectedSales)}의 매출이 필요해요`}>
        <ResponsiveContainer width="100%" height={390}>
          <ComposedChart data={chartData} margin={{ top: 76, right: 10, bottom: 18, left: 18 }}>
            <defs>
              <linearGradient id="recoveryAreaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4bd667" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#4bd667" stopOpacity="0.04" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#dfe2e1" strokeDasharray="4 4" />
            <ReferenceArea x1={months - 2} x2={months + 2} fill="#4bd667" fillOpacity={0.1} stroke="none" />
            <XAxis
              type="number"
              dataKey="month"
              domain={[6, 60]}
              ticks={PERIODS}
              interval={0}
              tickFormatter={(value) => `${value}개월`}
              tick={<RecoveryMonthTick selectedMonth={months} />}
              axisLine={{ stroke: "#8c9290" }}
              tickLine={false}
              height={56}
            >
              <Label value="회수 목표기간" position="insideBottom" offset={0} fill="#444a47" fontSize={13} fontWeight={750} />
            </XAxis>
            <YAxis
              type="number"
              domain={[2800, 3800]}
              ticks={salesTicks}
              tickFormatter={(value) => `${value.toLocaleString("ko-KR")}만`}
              tick={{ fill: "#686d72", fontSize: 11, fontWeight: 650 }}
              orientation="right"
              axisLine={false}
              tickLine={false}
              width={72}
            >
              <Label value="매달 필요한 매출" angle={90} position="insideRight" offset={4} fill="#444a47" fontSize={13} fontWeight={750} />
            </YAxis>
            <Tooltip content={<RecoveryTooltip />} cursor={{ stroke: "#377538", strokeWidth: 1.5, strokeDasharray: "4 4" }} />
            <Area type="monotone" dataKey="sales" name="필요 월매출" unit="만원" stroke="none" fill="url(#recoveryAreaFill)" fillOpacity={1} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="sales"
              name="필요 월매출"
              unit="만원"
              stroke="#377538"
              strokeWidth={4}
              dot={(props) => <RecoverySeriesDot {...props} selectedMonth={months} />}
              activeDot={{ r: 6, fill: "#377538", stroke: "#ffffff", strokeWidth: 2 }}
              isAnimationActive={false}
            >
              <LabelList content={(props) => <RecoverySeriesLabel {...props} selectedIndex={months - 6} selectedMonth={months} sales={selectedSales} />} />
            </Line>
            <ReferenceLine segment={[{ x: 6, y: selectedSales }, { x: months, y: selectedSales }]} stroke="#377538" strokeWidth={2} strokeDasharray="5 5" />
            <ReferenceLine segment={[{ x: months, y: 2800 }, { x: months, y: selectedSales }]} stroke="#377538" strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="rc-static-note"><CalendarCheck2 aria-hidden="true" size={18} /><span>회수 목표기간은 온보딩 입력값이에요. 결과 화면에서는 변경하지 않아요.</span></div>
      <p className="rc-source">출처: 온보딩에서 입력한 회수기간, Stay or Move Rule Engine 계산값</p>
    </section>
  );
}

function ScenarioCards({ months, onChange }) {
  return (
    <section className="rc-panel" aria-labelledby="cards-title">
      <div className="rc-panel-head">
        <div><span className="rc-label">비교 선택형</span><h2 id="cards-title">기간별 부담을 한눈에 비교해요</h2><p>곡선을 읽지 않아도 기간마다 필요한 매출 차이가 바로 보여요.</p></div>
        <div className="rc-compact-note"><span>유지선</span><strong>{won(MAINTENANCE)}</strong></div>
      </div>
      <div className="rc-scenario-grid">
        {CARD_PERIODS.map((period) => {
          const selected = period === months;
          const delta = requiredSales(period) - MAINTENANCE;
          return (
            <button key={period} type="button" className={selected ? "rc-scenario is-selected" : "rc-scenario"} onClick={() => onChange(period)} aria-pressed={selected}>
              <span className="rc-scenario-period">{period}개월</span>
              {selected && <span className="rc-selected-tag"><Check aria-hidden="true" size={13} />선택</span>}
              <strong>{won(requiredSales(period))}</strong>
              <span className="rc-scenario-delta">유지선보다 월 {won(delta)} 더 필요해요</span>
              <span className="rc-load-track" aria-hidden="true"><i style={{ width: `${Math.min(100, 22 + (delta / 444) * 70)}%` }} /></span>
            </button>
          );
        })}
      </div>
      <div className="rc-card-summary">
        <span>{months}개월을 선택했어요</span>
        <strong>매달 {won(requiredSales(months))}을 만들면 이전비를 기간 안에 회수해요</strong>
      </div>
      <p className="rc-source">출처: 사용자가 선택한 회수기간, Stay or Move Rule Engine 계산값</p>
    </section>
  );
}

function CashflowChart({ months, onChange }) {
  const width = 900;
  const height = 380;
  const left = 72;
  const right = 866;
  const top = 36;
  const bottom = 302;
  const minY = -6000;
  const maxY = 11000;
  const x = (month) => left + (month / 60) * (right - left);
  const y = (amount) => bottom - ((amount - minY) / (maxY - minY)) * (bottom - top);
  const monthsData = Array.from({ length: 61 }, (_, index) => index);
  const targetSlope = RELOCATION_COST / months;
  const mlSlope = ML_EXPECTED - MAINTENANCE;
  const targetPath = monthsData.map((month, index) => `${index === 0 ? "M" : "L"} ${x(month)} ${y(-RELOCATION_COST + targetSlope * month)}`).join(" ");
  const mlPath = monthsData.map((month, index) => `${index === 0 ? "M" : "L"} ${x(month)} ${y(-RELOCATION_COST + mlSlope * month)}`).join(" ");
  const mlRecovery = Math.ceil(RELOCATION_COST / mlSlope);

  return (
    <section className="rc-panel" aria-labelledby="cashflow-title">
      <div className="rc-panel-head">
        <div><span className="rc-label">손익분기형</span><h2 id="cashflow-title">누적 금액이 0원을 넘는 시점을 봐요</h2><p>목표 계획과 ML 예상 흐름이 이전비를 언제 회수하는지 비교해요.</p></div>
        <div className="rc-compact-note is-positive"><span>ML 예상 회수</span><strong>약 {mlRecovery}개월</strong></div>
      </div>
      <div className="rc-cashflow-controls" aria-label="목표 회수기간 선택">
        {[12, 24, 36, 48].map((period) => <button key={period} type="button" className={months === period ? "is-active" : ""} onClick={() => onChange(period)}>{period}개월</button>)}
      </div>
      <div className="rc-chart-wrap">
        <svg className="rc-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`목표 계획은 ${months}개월, ML 예상 흐름은 약 ${mlRecovery}개월에 이전비를 회수해요`}>
          <rect x={left} y={top} width={right - left} height={y(0) - top} className="rc-profit-area" />
          <rect x={left} y={y(0)} width={right - left} height={bottom - y(0)} className="rc-risk-area" />
          {[-5000, 0, 5000, 10000].map((amount) => <g key={amount}><line x1={left} x2={right} y1={y(amount)} y2={y(amount)} className={amount === 0 ? "rc-zero" : "rc-grid"} /><text x={left - 13} y={y(amount) + 4} className="rc-y-tick" textAnchor="end">{amount === 0 ? "0원" : `${amount > 0 ? "+" : "-"}${Math.abs(amount / 10000).toFixed(1)}억원`}</text></g>)}
          {[0, 12, 24, 36, 48, 60].map((period) => <text key={period} x={x(period)} y={bottom + 34} className="rc-tick" textAnchor="middle">{period}개월</text>)}
          <text x={left + 14} y={top + 22} className="rc-zone-label is-profit">회수 이후</text>
          <text x={left + 14} y={y(0) + 24} className="rc-zone-label is-risk">회수 전</text>
          <path d={targetPath} className="rc-target-line" />
          <path d={mlPath} className="rc-ml-line" />
          <circle cx={x(months)} cy={y(0)} r="6" className="rc-target-dot" />
          <circle cx={x(mlRecovery)} cy={y(-RELOCATION_COST + mlSlope * mlRecovery)} r="7" className="rc-ml-dot" />
          <text x={x(months)} y={y(0) - 15} className="rc-target-label" textAnchor="middle">목표 {months}개월</text>
          <text x={x(mlRecovery) + 12} y={y(-RELOCATION_COST + mlSlope * mlRecovery) + 23} className="rc-ml-label">ML 예상 약 {mlRecovery}개월</text>
        </svg>
      </div>
      <div className="rc-line-key" aria-label="선 설명"><span><i className="target" />목표 계획</span><span><i className="ml" />ML 예상 흐름</span></div>
      <p className="rc-source">출처: ML 예상매출, 사용자가 선택한 회수기간, Stay or Move Rule Engine 계산값</p>
    </section>
  );
}

function RecoveryConcepts() {
  const [active, setActive] = useState("direct");
  const [periodByView, setPeriodByView] = useState({ direct: 24, cards: 24, cashflow: 24 });
  const months = periodByView[active];
  const setMonths = (value) => setPeriodByView((current) => ({ ...current, [active]: value }));
  const ActiveView = useMemo(() => ({ direct: DirectChart, cards: ScenarioCards, cashflow: CashflowChart }[active]), [active]);

  return (
    <main className="rc-page">
      <header className="rc-topbar"><strong>stay or move</strong><span>결과지 그래프 탐색</span><em>별도 시안</em></header>
      <div className="rc-shell">
        <header className="rc-heading"><span>회수기간 시각화</span><h1>같은 계산값을 세 가지 방식으로 비교해요</h1><p>현재 결과지는 그대로 두고, 조작 방식과 정보 구조만 다르게 만든 간단한 시안이에요.</p></header>
        <SegmentTabs active={active} onChange={setActive} />
        <ActiveView months={months} onChange={setMonths} />
        <aside className="rc-review-note"><strong>비교할 기준</strong><span>기간을 고르는 속도</span><span>필요 매출을 이해하는 속도</span><span>회수 시점을 신뢰하는 정도</span></aside>
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><RecoveryConcepts /></React.StrictMode>);
