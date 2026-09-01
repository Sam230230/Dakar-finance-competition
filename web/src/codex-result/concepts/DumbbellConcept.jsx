import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { chartCandidates, signedPercent, won } from "./chartData.js";
import "./concepts.css";

const WIDTH = 1080;
const HEIGHT = 450;
const LEFT = 235;
const RIGHT = 1010;
const TOP = 70;
const DOMAIN = [-5, 30];
const ticks = [-5, 0, 10, 20, 30];
const x = (value) => LEFT + ((value - DOMAIN[0]) / (DOMAIN[1] - DOMAIN[0])) * (RIGHT - LEFT);

function DumbbellConcept() {
  const [active, setActive] = useState(chartCandidates[1]);

  return (
    <main className="cc-page">
      <header className="cc-topbar">
        <strong className="cc-brand">stay or move</strong><span>매출 가능성 그래프 탐색</span>
        <nav className="cc-switch" aria-label="그래프 시안 이동">
          <a className="is-active" href="/codex-dumbbell-concept.html">덤벨 플롯</a>
          <a href="/codex-quadrant-concept.html">사분면 지도</a>
        </nav>
      </header>
      <div className="cc-shell">
        <div className="cc-heading">
          <div><p className="cc-kicker">시안 1 · 성장 거리 비교</p><h1>지금보다 얼마나 더 팔아야 하는지 비교해요</h1></div>
          <p>현재 매출을 0%로 두고 최소 필요매출과 ML 예상매출 사이의 거리를 보여줘요.</p>
        </div>

        <section className="cc-chart-card" aria-labelledby="dumbbell-title">
          <div className="cc-card-head">
            <div><h2 id="dumbbell-title">현재 매출 대비 증감률</h2><p>점이나 후보 이름에 마우스를 올리면 원화 금액을 확인할 수 있어요.</p></div>
            <div className="cc-legend" aria-label="범례"><span><i className="need" />최소 필요</span><span><i className="expect" />ML 예상</span><span><i className="current" />현재 매출</span></div>
          </div>
          <div className="cc-svg-wrap">
            <svg className="cc-svg is-dumbbell" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="후보별 현재 매출 대비 최소 필요 성장률과 예상 성장률 덤벨 플롯">
              {ticks.map((tick) => (
                <g key={tick}>
                  <line x1={x(tick)} x2={x(tick)} y1={TOP} y2={410} stroke={tick === 0 ? "#46504b" : "#e1e5e2"} strokeWidth={tick === 0 ? 2 : 1} strokeDasharray={tick === 0 ? "6 6" : undefined} />
                  <text x={x(tick)} y="42" fill={tick === 0 ? "#202723" : "#7a827e"} fontSize="12" fontWeight={tick === 0 ? 800 : 600} textAnchor="middle">{tick === 0 ? "현재 0%" : `${tick > 0 ? "+" : ""}${tick}%`}</text>
                </g>
              ))}
              {chartCandidates.map((item, index) => {
                const y = 132 + index * 125;
                const selected = active.id === item.id;
                return (
                  <g className="cc-point" key={item.id} tabIndex="0" role="button" aria-label={`${item.name}, 필요 ${signedPercent(item.need)}, 예상 ${signedPercent(item.expect)}`} onMouseEnter={() => setActive(item)} onFocus={() => setActive(item)} onClick={() => setActive(item)}>
                    {selected && <rect x="0" y={y - 49} width={WIDTH} height="98" rx="10" fill="#f7faf8" />}
                    <text x="4" y={y - 5} fill={item.recommended ? "#146c3a" : "#121619"} fontSize="17" fontWeight="800">{item.name}</text>
                    <text x="4" y={y + 18} fill="#747c78" fontSize="11">후보 {item.id}{item.recommended ? "  추천" : ""}</text>
                    <line x1={LEFT} x2={RIGHT} y1={y} y2={y} stroke="#d7dcd8" strokeWidth="2" />
                    <line x1={x(item.need)} x2={x(item.expect)} y1={y} y2={y} stroke={item.recommended ? "#63c77a" : "#aeb6b1"} strokeWidth="6" strokeLinecap="round" />
                    <circle cx={x(item.need)} cy={y} r="9" fill="#fff" stroke="#4f5753" strokeWidth="3" />
                    <circle cx={x(item.expect)} cy={y} r="9" fill="#1f9d55" stroke="#fff" strokeWidth="3" />
                    <circle cx={x(item.expect)} cy={y} r="11" fill="none" stroke="#146c3a" strokeWidth="2" />
                    <text x={x(item.need)} y={y + 31} fill="#4f5753" fontSize="11" fontWeight="750" textAnchor="middle">필요 {signedPercent(item.need)}</text>
                    <text x={x(item.expect)} y={y - 21} fill="#146c3a" fontSize="11" fontWeight="800" textAnchor="middle">예상 {signedPercent(item.expect)}</text>
                  </g>
                );
              })}
            </svg>
            <div className="cc-tooltip" aria-live="polite">
              <strong>{active.name}</strong>
              <span>최소 필요 <b>{signedPercent(active.need)}</b> · {won(active.needWon)}</span>
              <span>ML 예상 <b>{signedPercent(active.expect)}</b> · {won(active.expectWon)}</span>
              <small>현재 월매출 2,800만원 기준</small>
            </div>
          </div>
          <p className="cc-chart-note">추천 여부는 색으로만 구분하지 않고 후보 이름의 ‘추천’ 텍스트를 함께 제공해요. ML 예상값은 실제 매출을 보장하지 않아요.</p>
        </section>
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><DumbbellConcept /></React.StrictMode>);
