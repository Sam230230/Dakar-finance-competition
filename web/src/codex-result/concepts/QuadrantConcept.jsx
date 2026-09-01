import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { chartCandidates, signedPercent } from "./chartData.js";
import "./concepts.css";

const WIDTH = 1080;
const HEIGHT = 560;
const LEFT = 100;
const RIGHT = 1010;
const TOP = 48;
const BOTTOM = 475;
const X_DOMAIN = [-5, 25];
const Y_DOMAIN = [0, 12];
const xTicks = [-5, 0, 5, 10, 15, 20, 25];
const yTicks = [0, 3, 6, 9, 12];
const x = (value) => LEFT + ((value - X_DOMAIN[0]) / (X_DOMAIN[1] - X_DOMAIN[0])) * (RIGHT - LEFT);
const y = (value) => BOTTOM - ((value - Y_DOMAIN[0]) / (Y_DOMAIN[1] - Y_DOMAIN[0])) * (BOTTOM - TOP);

function QuadrantConcept() {
  const [active, setActive] = useState(chartCandidates[1]);

  return (
    <main className="cc-page">
      <header className="cc-topbar">
        <strong className="cc-brand">stay or move</strong><span>매출 가능성 그래프 탐색</span>
        <nav className="cc-switch" aria-label="그래프 시안 이동">
          <a href="/codex-dumbbell-concept.html">덤벨 플롯</a>
          <a className="is-active" href="/codex-quadrant-concept.html">사분면 지도</a>
        </nav>
      </header>
      <div className="cc-shell">
        <div className="cc-heading">
          <div><p className="cc-kicker">시안 2 · 부담과 안전성</p><h1>성장 부담과 예상 여유를 함께 판단해요</h1></div>
          <p>왼쪽일수록 필요한 성장이 작고, 위쪽일수록 필요매출을 넘는 예상 여유가 커요.</p>
        </div>

        <section className="cc-chart-card" aria-labelledby="quadrant-title">
          <div className="cc-card-head">
            <div><h2 id="quadrant-title">후보 의사결정 지도</h2><p>좌측 상단에 가까울수록 부담이 낮고 예상 안전성이 높아요.</p></div>
            <div className="cc-legend"><span><i className="expect" />추천 후보</span><span>기준선: 성장 10% · 여유 5%</span></div>
          </div>
          <div className="cc-svg-wrap">
            <svg className="cc-svg is-quadrant" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="후보별 성장 부담과 예상 여유 사분면 지도">
              <rect x={LEFT} y={TOP} width={x(10) - LEFT} height={y(5) - TOP} fill="#edf8f0" />
              <rect x={x(10)} y={TOP} width={RIGHT - x(10)} height={y(5) - TOP} fill="#f6f8f6" />
              <rect x={LEFT} y={y(5)} width={x(10) - LEFT} height={BOTTOM - y(5)} fill="#f8f9f8" />
              <rect x={x(10)} y={y(5)} width={RIGHT - x(10)} height={BOTTOM - y(5)} fill="#fbf4f2" />
              <text x={LEFT + 16} y={TOP + 25} fill="#146c3a" fontSize="12" fontWeight="800">부담 낮고 여유 큼</text>
              <text x={x(10) + 16} y={TOP + 25} fill="#717975" fontSize="11" fontWeight="700">여유는 크지만 성장 필요</text>
              <text x={LEFT + 16} y={y(5) + 27} fill="#717975" fontSize="11" fontWeight="700">부담은 낮지만 여유 확인</text>
              <text x={x(10) + 16} y={y(5) + 27} fill="#9a625b" fontSize="11" fontWeight="700">부담과 여유 모두 주의</text>
              {xTicks.map((tick) => <g key={tick}><line x1={x(tick)} x2={x(tick)} y1={TOP} y2={BOTTOM} stroke={tick === 10 ? "#77807b" : "#dfe4e0"} strokeDasharray={tick === 10 ? "6 6" : undefined} /><text x={x(tick)} y={BOTTOM + 25} fill="#747c78" fontSize="11" textAnchor="middle">{tick > 0 ? "+" : ""}{tick}%</text></g>)}
              {yTicks.map((tick) => <g key={tick}><line x1={LEFT} x2={RIGHT} y1={y(tick)} y2={y(tick)} stroke={tick === 5 ? "#77807b" : "#dfe4e0"} strokeDasharray={tick === 5 ? "6 6" : undefined} /><text x={LEFT - 15} y={y(tick) + 4} fill="#747c78" fontSize="11" textAnchor="end">{tick}%</text></g>)}
              <line x1={x(10)} x2={x(10)} y1={TOP} y2={BOTTOM} stroke="#77807b" strokeWidth="1.5" strokeDasharray="6 6" />
              <line x1={LEFT} x2={RIGHT} y1={y(5)} y2={y(5)} stroke="#77807b" strokeWidth="1.5" strokeDasharray="6 6" />
              <text x={(LEFT + RIGHT) / 2} y="545" fill="#424a46" fontSize="12" fontWeight="750" textAnchor="middle">필요한 성장률 · 낮을수록 부담이 작아요 →</text>
              <text x="22" y={(TOP + BOTTOM) / 2} fill="#424a46" fontSize="12" fontWeight="750" textAnchor="middle" transform={`rotate(-90 22 ${(TOP + BOTTOM) / 2})`}>예상 여유율 · 높을수록 안전해요 →</text>
              {chartCandidates.map((item) => {
                const selected = active.id === item.id;
                return (
                  <g className="cc-point" key={item.id} tabIndex="0" role="button" aria-label={`${item.name}, 성장 부담 ${signedPercent(item.need)}, 예상 여유 ${item.margin.toFixed(1)}%`} onMouseEnter={() => setActive(item)} onFocus={() => setActive(item)} onClick={() => setActive(item)}>
                    {selected && <circle cx={x(item.need)} cy={y(item.margin)} r="27" fill="rgba(31,157,85,.12)" />}
                    <circle cx={x(item.need)} cy={y(item.margin)} r={item.recommended ? 15 : 12} fill={item.recommended ? "#1f9d55" : "#fff"} stroke={item.recommended ? "#146c3a" : "#39413d"} strokeWidth="3" />
                    <text x={x(item.need)} y={y(item.margin) - 24} fill={item.recommended ? "#146c3a" : "#252c28"} fontSize="13" fontWeight="850" textAnchor="middle">{item.shortName}{item.recommended ? " · 추천" : ""}</text>
                    <text x={x(item.need)} y={y(item.margin) + 34} fill="#69716d" fontSize="10" fontWeight="650" textAnchor="middle">부담 {signedPercent(item.need)} · 여유 {item.margin.toFixed(1)}%</text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="cc-quadrant-detail" aria-live="polite">
            <div><span>선택 후보</span><strong>{active.name}</strong></div>
            <p>{active.summary}</p>
            <div className="cc-detail-metrics"><b><small>성장 부담</small>{signedPercent(active.need)}</b><b><small>예상 여유</small>+{active.margin.toFixed(1)}%</b></div>
          </div>
          <p className="cc-chart-note">영역 색은 판단을 돕는 보조 정보이며 후보명, 축 수치, 설명을 함께 제공해 색만으로 의미를 전달하지 않아요.</p>
        </section>
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><QuadrantConcept /></React.StrictMode>);
