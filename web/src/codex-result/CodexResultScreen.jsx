import { useMemo, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, CircleAlert, Info, MapPin, RotateCcw } from "lucide-react";
import MapView from "../MapView";
import { money, percent, signed } from "./format";

const TABS = [
  { id: "summary", label: "판단 요약" },
  { id: "money", label: "돈의 흐름" },
  { id: "market", label: "상권과 지원" },
];

// 후보 식별색. 색상이 아니라 명도로 구분한다 — 색약에서도 밝기로 갈린다.
const SITE_COLOR = { current: "#121619", A: "#046B36", B: "#02C551", C: "#8CDCB0" };

function salesState(candidate) {
  const predicted = Number(candidate?.ml?.predicted_monthly_sales);
  const required = Number(candidate?.min_required_sales);
  if (!Number.isFinite(predicted) || !Number.isFinite(required) || !required) return null;
  return { predicted, required, ratio: predicted / required, gap: predicted - required };
}

function candidateRank(data, id) {
  const index = (data?.ranking?.ranking || []).indexOf(id);
  return index < 0 ? null : index + 1;
}

export default function CodexResultScreen({ data, places, aiState, onRestart = () => {} }) {
  const rows = data?.candidates || [];
  const recommendedId = data?.ranking?.recommended_candidate || rows[0]?.site_id;
  const [selectedId, setSelectedId] = useState(recommendedId);
  const [tab, setTab] = useState("summary");
  const selected = rows.find((row) => row.site_id === selectedId) || rows[0] || {};
  const rankingReason = data?.ranking?.reasons?.[selected.site_id] || {};
  const state = salesState(selected);

  const drivers = useMemo(() => {
    const lift = data?.current_monthly_sales
      ? (selected.min_required_sales / data.current_monthly_sales - 1) * 100
      : null;
    return [
      {
        label: "필요한 매출 변화",
        value: lift == null ? "확인 불가" : lift <= 0 ? `${Math.abs(lift).toFixed(1)}% 낮아도 돼요` : `${lift.toFixed(1)}% 더 필요해요`,
        detail: `현재 ${money(data?.current_monthly_sales)}만원에서 최소 ${money(selected.min_required_sales)}만원이 필요해요.`,
      },
      {
        label: "추가로 마련할 돈",
        value: selected.additional_fund_needed > 0 ? `${money(selected.additional_fund_needed)}만원 필요해요` : "지금 가진 돈으로 가능해요",
        detail: `이전 소요자금 ${money(selected.initial_capital)}만원 중 ${money(selected.available_self_fund)}만원을 바로 쓸 수 있어요.`,
      },
      {
        label: "회수 예상",
        value: selected.scenarios?.[0]?.payback_months ? `약 ${selected.scenarios[0].payback_months}개월이에요` : "계산할 수 없어요",
        detail: `현재 매출을 유지한다고 보고 ${selected.target_months || data?.target_recovery_months || 24}개월 목표와 비교했어요.`,
      },
    ];
  }, [data, selected]);

  return (
    <main className="cx-report">
      <header className="cx-topbar">
        <a className="cx-brand" href="#top" aria-label="Stay or Move 결과지 맨 위로">stay or move</a>
        <p>후보지 분석 결과</p>
        <button type="button" onClick={onRestart}><RotateCcw size={16} /> 다시 분석</button>
      </header>

      <div className="cx-shell" id="top">
        <section className="cx-result-shelf" aria-labelledby="result-title">
          <div className="cx-title-row">
            <div>
              <h1 id="result-title">어느 자리가 가장 현실적인지 비교했어요</h1>
            </div>
            <p className="cx-updated">기준 단위 만원</p>
          </div>

          <div className="cx-candidate-list">
            {rows.map((candidate) => {
              const active = candidate.site_id === selected.site_id;
              const rank = candidateRank(data, candidate.site_id);
              const candidateState = salesState(candidate);
              return (
                <button
                  className={`cx-candidate ${active ? "is-active" : ""}`}
                  key={candidate.site_id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedId(candidate.site_id)}
                >
                  <span className="cx-candidate-top">
                    <span className={`cx-rank ${rank === 1 ? "is-first" : ""}`}>{rank ? `${rank}순위` : "비교"}</span>
                    {candidate.site_id === recommendedId && <span className="cx-recommend">추천 후보</span>}
                  </span>
                  <strong className="cx-place">{candidate.name}</strong>
                  <span className="cx-candidate-code">후보 {candidate.site_id}</span>
                  <span className="cx-card-foot">
                    <span>{candidateState?.gap >= 0 ? "예상 매출 충족" : "예상 매출 부족"}</span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <nav className="cx-tabs" aria-label="결과 분석 범위">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? "is-active" : ""}
              type="button"
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <section className="cx-guide" aria-label="결과 읽는 법">
          <Info size={20} aria-hidden="true" />
          <div>
            <strong>후보 {selected.site_id}의 결과를 보고 있어요.</strong>
            <p>추천 순위보다 예상 매출, 필요한 돈, 회수기간이 내 상황에 맞는지 먼저 확인해 주세요.</p>
          </div>
        </section>

        {tab === "summary" && (
          <SummaryPanel
            data={data}
            candidate={selected}
            state={state}
            drivers={drivers}
            rankingReason={rankingReason}
            rows={rows}
            aiState={aiState}
            onSelectCandidate={setSelectedId}
          />
        )}
        {tab === "money" && <MoneyPanel data={data} candidate={selected} rows={rows} />}
        {tab === "market" && (
          <MarketPanel candidate={selected} rows={rows} places={places} selectedId={selected.site_id} />
        )}

        <section className="cx-bottom-action">
          <div>
            <p>입력한 조건이 달라지면 결과도 달라져요.</p>
            <strong>임대료나 가용현금을 바꿔 다시 비교할 수 있어요.</strong>
          </div>
          <button type="button" onClick={onRestart}>조건 바꿔보기 <ArrowUpRight size={17} /></button>
        </section>
      </div>
    </main>
  );
}

/**
 * AI 해석. 백엔드가 /staymove/explain 으로 이미 만들어 보내는 값이라
 * 화면에서 버리면 호출 비용과 대기 시간만 쓰고 결과를 안 쓰는 셈이 된다.
 *
 * mode 가 "llm" 일 때만 카드 세 장을 편다. AI가 꺼져 있거나 실패하면
 * strengths/risks/decision_condition 이 빈 값으로 오기 때문에,
 * 그대로 그리면 빈 카드만 남는다. 그때는 규칙 기반 문단과 확인사항만 남긴다.
 */
function AiInsight({ candidate, overall, aiState }) {
  const ai = candidate?.ai_explanation;
  if (!ai) return null;

  const failed = aiState === "error";
  const hasLlm = !failed && ai.mode === "llm";
  const strengths = ai.strengths || [];
  const risks = ai.risks || [];
  const checks = ai.important_checks || [];

  return (
    <section className="cx-section-card" aria-labelledby="ai-insight">
      <div className="cx-section-head">
        <div><h2 id="ai-insight">계산 결과를 이렇게 읽었어요</h2></div>
        <span className="cx-help">계산값과 검색된 정책 근거만 사용</span>
      </div>

      {!hasLlm && (
        <p className="cx-plain-note">
          {failed
            ? "AI 해석을 불러오지 못했어요. 아래는 계산과 검색 결과만 정리한 내용이에요."
            : "AI 해석이 꺼져 있어서, 아래는 계산과 검색 결과만 정리한 내용이에요."}
        </p>
      )}

      {hasLlm && ai.one_line_summary && <p className="cx-ai-lead">{ai.one_line_summary}</p>}

      {hasLlm && (
        <div className="cx-ai-grid">
          <article>
            <h3>좋은 점</h3>
            <ul>{strengths.map((item, i) => <li key={i}>{item}</li>)}</ul>
          </article>
          <article>
            <h3>주의할 점</h3>
            <ul className="is-risk">{risks.map((item, i) => <li key={i}>{item}</li>)}</ul>
          </article>
          <article>
            <h3>고르려면 이게 지켜져야 해요</h3>
            <p>{ai.decision_condition}</p>
          </article>
        </div>
      )}

      {ai.candidate_interpretation && <p className="cx-ai-para">{ai.candidate_interpretation}</p>}

      {checks.length > 0 && (
        <ul className="cx-ai-checks">
          {checks.map((item, i) => (
            <li key={i}><CircleAlert size={14} aria-hidden="true" />{item}</li>
          ))}
        </ul>
      )}

      {overall?.main_risk && <p className="cx-ai-risk"><CircleAlert size={15} aria-hidden="true" />{overall.main_risk}</p>}
      {overall?.reason && <p className="cx-plain-note">{overall.reason}</p>}
    </section>
  );
}

function SummaryPanel({ data, candidate, state, drivers, rankingReason, rows, aiState, onSelectCandidate }) {
  const headline = candidate.site_id === data?.ranking?.recommended_candidate
    ? data?.overall?.headline || `후보 ${candidate.site_id}가 가장 현실적이에요.`
    : `후보 ${candidate.site_id}는 ${candidateRank(data, candidate.site_id) || "비교"}순위예요.`;
  const buffer = rankingReason.sales_buffer_ratio;

  return (
    <div className="cx-panel-stack">
      <section className="cx-verdict-card">
        <div className="cx-verdict-main">
          <h2>{headline}</h2>
          <p className="cx-summary-copy">{data?.comparison_summary || "계산된 조건을 기준으로 후보지를 비교했어요."}</p>
          <div className="cx-status-row">
            <span className={state?.gap >= 0 ? "is-good" : "is-risk"}>
              {state?.gap >= 0 ? <Check size={15} /> : <CircleAlert size={15} />}
              {state?.gap >= 0 ? `예상 매출이 기준보다 ${money(state.gap)}만원 높아요` : `예상 매출이 기준보다 ${money(Math.abs(state?.gap))}만원 부족해요`}
            </span>
            <span className={candidate.additional_fund_needed > 0 ? "is-risk" : "is-good"}>
              {candidate.additional_fund_needed > 0 ? <CircleAlert size={15} /> : <Check size={15} />}
              {candidate.additional_fund_needed > 0 ? `추가로 ${money(candidate.additional_fund_needed)}만원이 필요해요` : "추가 자금이 필요하지 않아요"}
            </span>
          </div>
        </div>
        <aside className="cx-verdict-aside">
          <span>판단 여유</span>
          <strong>{buffer == null ? "확인 불가" : percent(buffer * 100)}</strong>
          <div className="cx-ring" style={{ "--score": `${Math.max(8, Math.min(100, (buffer || 0) * 500 + 45))}%` }} aria-hidden="true" />
          <p>예상 매출이 최소 필요매출을 넘는 폭이에요.</p>
        </aside>
      </section>

      <AiInsight candidate={candidate} overall={data?.overall} aiState={aiState} />

      <section className="cx-section-card" aria-labelledby="decision-drivers">
        <div className="cx-section-head">
          <div><h2 id="decision-drivers">이 세 가지를 먼저 보세요</h2></div>
          <span className="cx-help">현재 조건 기준</span>
        </div>
        <ol className="cx-driver-list">
          {drivers.map((driver, index) => (
            <li key={driver.label}>
              <span className={`cx-driver-rank ${index === 0 ? "is-first" : ""}`}>{["1st", "2nd", "3rd"][index]}</span>
              <div><p>{driver.label}</p><strong>{driver.value}</strong><span>{driver.detail}</span></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="cx-section-card" aria-labelledby="sales-check">
        <div className="cx-section-head"><div><h2 id="sales-check">성장 부담과 예상 여유를 함께 판단해요</h2></div><span className="cx-help">왼쪽 위가 유리해요</span></div>
        <CandidateDecisionMap
          rows={rows}
          currentSales={data?.current_monthly_sales}
          recommendedId={data?.ranking?.recommended_candidate}
          selectedId={candidate.site_id}
          onSelect={onSelectCandidate}
        />
        <p className="cx-plain-note">가로축은 현재보다 필요한 매출 성장률, 세로축은 최소 필요매출을 넘는 예상 여유율이에요. ML 예상값은 실제 매출을 보장하지 않아요.</p>
      </section>
    </div>
  );
}

function CandidateDecisionMap({ rows, currentSales, recommendedId, selectedId, onSelect }) {
  const [hoveredId, setHoveredId] = useState(null);
  const usable = rows.filter((row) => Number.isFinite(Number(row.min_required_sales)) && Number.isFinite(Number(row.ml?.predicted_monthly_sales)));
  const current = Number(currentSales);
  if (!usable.length || !Number.isFinite(current) || current <= 0) return <div className="cx-empty"><strong>비교할 예상매출이 없어요.</strong><p>현재 매출과 예측값을 불러오면 후보별 차이를 보여드려요.</p></div>;

  const WIDTH = 1040;
  const HEIGHT = 580;
  const LEFT = 92;
  const RIGHT = 986;
  const TOP = 48;
  const BOTTOM = 490;
  const metrics = usable.map((row) => ({
    ...row,
    burden: (Number(row.min_required_sales) / current - 1) * 100,
    margin: (Number(row.ml.predicted_monthly_sales) / Number(row.min_required_sales) - 1) * 100,
  }));
  // 축 범위는 데이터와 기준선을 함께 담되, 양쪽에 같은 규칙을 쓴다.
  //
  // 예전에는 X만 [-5, 25]로 못박고 Y는 데이터를 그대로 따라가서, 후보 하나가
  // -65%면 세로 축만 90포인트로 늘어났다. 그러면 1%가 가로에서는 29.8px,
  // 세로에서는 4.2px가 되어 배율이 7배 어긋나고, 정작 판단이 갈리는
  // 기준선 부근이 맨 위 얇은 띠로 눌린다.
  // 여유율 바닥. -20%보다 낮으면 어차피 "많이 모자란다" 하나로 읽히고,
  // 그 아래까지 축을 늘리면 기준선 부근이 눌린다. 바닥에 모아 표시하고
  // 실제 수치는 점 아래와 툴팁에 그대로 남긴다.
  const Y_FLOOR = -20;

  function axisDomain(values, mustInclude, minSpan, { padBottom = true, step = 5 } = {}) {
    const pool = [...values, ...mustInclude];
    const lo = Math.min(...pool);
    const hi = Math.max(...pool);
    const pad = Math.max(step / 2, (hi - lo) * 0.12);
    let min = padBottom ? Math.floor((lo - pad) / step) * step : lo;
    let max = Math.ceil((hi + pad) / step) * step;
    if (max - min < minSpan) max = min + minSpan;
    return [min, max];
  }

  // 축 아래로 벗어난 후보는 바닥에 붙여 그리되 실제 수치는 라벨과 툴팁에 남긴다.
  const plotMargin = (value) => Math.max(value, Y_FLOOR);
  const isBelowFloor = (value) => value < Y_FLOOR;
  const clamped = metrics.some((row) => isBelowFloor(row.margin));

  const X_DOMAIN = axisDomain(metrics.map((row) => row.burden), [0, 10], 20);
  // 바닥에 모아 표시하는 중이면 그 아래로 여백을 더 두지 않는다.
  // 여백을 주면 축이 다시 늘어나 배율이 어긋난다.
  const Y_DOMAIN = axisDomain(metrics.map((row) => plotMargin(row.margin)), [0, 5], 25, { padBottom: !clamped });

  const tickStep = (domain) => (domain[1] - domain[0] > 45 ? 10 : 5);
  const buildTicks = (domain, extra = []) => {
    const step = tickStep(domain);
    const start = Math.ceil(domain[0] / step) * step;
    const count = Math.floor((domain[1] - start) / step) + 1;
    const base = Array.from({ length: count }, (_, index) => start + index * step);
    return [...new Set([...base, ...extra])]
      .filter((tick) => tick >= domain[0] && tick <= domain[1])
      .sort((a, b) => a - b);
  };
  const xTicks = buildTicks(X_DOMAIN);
  const yTicks = buildTicks(Y_DOMAIN, [5]);

  const x = (value) => LEFT + ((value - X_DOMAIN[0]) / (X_DOMAIN[1] - X_DOMAIN[0])) * (RIGHT - LEFT);
  const y = (value) => BOTTOM - ((plotMargin(value) - Y_DOMAIN[0]) / (Y_DOMAIN[1] - Y_DOMAIN[0])) * (BOTTOM - TOP);
  // 바닥에 모은 점은 축선 위에 얹으면 아래 절반이 잘린다. 지름만큼 띄운다.
  const pointY = (value) => (isBelowFloor(value) ? BOTTOM - 20 : y(value));
  const hasBelowFloor = clamped;
  const selected = metrics.find((row) => row.site_id === selectedId) || metrics[0];
  const hovered = metrics.find((row) => row.site_id === hoveredId);
  const explain = (row) => {
    if (row.burden <= 5 && row.margin >= 5) return "필요한 성장 폭은 작고 예상 여유는 충분해 균형이 좋아요.";
    if (row.burden > 10 && row.margin >= 5) return "예상 여유는 충분하지만 현재보다 큰 폭의 매출 성장이 필요해요.";
    if (row.burden <= 5 && row.margin < 5) return "현재 부담은 낮지만 예상 매출의 여유 폭을 더 확인해야 해요.";
    return "필요한 성장 폭과 예상 여유를 함께 보수적으로 확인해야 해요.";
  };

  return (
    <div className="cx-decision-map">
      <div className="cx-map-legend" aria-hidden="true">
        <span><i />추천 후보</span>
        <span>기준선: 성장 10%, 여유 5%</span>
        {hasBelowFloor && <span>여유 {Y_FLOOR}% 아래는 축 맨 아래에 모아서 표시해요</span>}
      </div>
      <div className="cx-map-canvas">
        <svg className="cx-map-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="후보별 필요한 성장률과 예상 여유율 의사결정 지도">
          <rect x={LEFT} y={TOP} width={x(10) - LEFT} height={y(5) - TOP} className="cx-zone is-balanced" />
          <rect x={x(10)} y={TOP} width={RIGHT - x(10)} height={y(5) - TOP} className="cx-zone is-growth" />
          <rect x={LEFT} y={y(5)} width={x(10) - LEFT} height={BOTTOM - y(5)} className="cx-zone is-watch" />
          <rect x={x(10)} y={y(5)} width={RIGHT - x(10)} height={BOTTOM - y(5)} className="cx-zone is-risk" />
          <text x={LEFT + 14} y={TOP + 23} className="cx-zone-label is-balanced">부담 낮고 여유 큼</text>
          <text x={x(10) + 14} y={TOP + 23} className="cx-zone-label">여유는 크지만 성장 필요</text>
          <text x={LEFT + 14} y={y(5) + 24} className="cx-zone-label">부담은 낮지만 여유 확인</text>
          <text x={x(10) + 14} y={y(5) + 24} className="cx-zone-label is-risk">부담과 여유 모두 주의</text>

          {xTicks.map((tick) => (
            <g key={`x-${tick}`}>
              <line x1={x(tick)} x2={x(tick)} y1={TOP} y2={BOTTOM} className="cx-map-grid" />
              <text x={x(tick)} y={BOTTOM + 24} className="cx-map-tick" textAnchor="middle">{tick > 0 ? "+" : ""}{tick}%</text>
            </g>
          ))}
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line x1={LEFT} x2={RIGHT} y1={y(tick)} y2={y(tick)} className="cx-map-grid" />
              <text x={LEFT - 13} y={y(tick) + 4} className="cx-map-tick" textAnchor="end">{tick > 0 ? "+" : ""}{tick}%</text>
            </g>
          ))}
          <line x1={x(10)} x2={x(10)} y1={TOP} y2={BOTTOM} className="cx-map-threshold" />
          <line x1={LEFT} x2={RIGHT} y1={y(5)} y2={y(5)} className="cx-map-threshold" />
          <text x={(LEFT + RIGHT) / 2} y={HEIGHT - 12} className="cx-map-axis-label" textAnchor="middle">필요한 성장률, 낮을수록 부담이 작아요 →</text>
          <text x="24" y={(TOP + BOTTOM) / 2} className="cx-map-axis-label" textAnchor="middle" transform={`rotate(-90 24 ${(TOP + BOTTOM) / 2})`}>예상 여유율, 높을수록 안전해요 →</text>

          <line x1={LEFT} x2={x(selected.burden)} y1={pointY(selected.margin)} y2={pointY(selected.margin)} className="cx-selected-guide" />
          <line x1={x(selected.burden)} x2={x(selected.burden)} y1={pointY(selected.margin)} y2={BOTTOM} className="cx-selected-guide" />

          {metrics.map((row) => {
            const isSelected = row.site_id === selected.site_id;
            const recommended = row.site_id === recommendedId;
            const shortName = row.name.split(" ").slice(-2).join(" ");
            return (
              <g
                className={`cx-map-point ${isSelected ? "is-selected" : ""} ${recommended ? "is-recommended" : ""}`}
                key={row.site_id}
                tabIndex="0"
                role="button"
                aria-label={`${row.name}, 성장 부담 ${signed(row.burden)}, 예상 여유 ${percent(row.margin)}`}
                onMouseEnter={() => setHoveredId(row.site_id)}
                onMouseLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(row.site_id)}
                onBlur={() => setHoveredId(null)}
                onClick={() => onSelect(row.site_id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(row.site_id);
                  }
                }}
                style={{ opacity: isSelected ? 1 : .48 }}
              >
                {isSelected && <circle cx={x(row.burden)} cy={pointY(row.margin)} r="25" className="cx-map-halo" />}
                <circle cx={x(row.burden)} cy={pointY(row.margin)} r={recommended ? 14 : 12} className="cx-map-dot" />
                {/* 축 아래로 벗어난 후보는 바닥에 붙지만, 값은 감추지 않고 그대로 적는다 */}
                {isBelowFloor(row.margin) && (
                  <text x={x(row.burden)} y={BOTTOM - 2} className="cx-map-offscale" textAnchor="middle">
                    실제 {signed(row.margin)}
                  </text>
                )}
                {/* 점이 위쪽 끝에 붙으면 이름표가 사분면 라벨과 겹쳐서 아래로 내린다 */}
                <text
                  x={x(row.burden)}
                  y={pointY(row.margin) < TOP + 42 ? pointY(row.margin) + 34 : pointY(row.margin) - 23}
                  className="cx-map-name"
                  textAnchor="middle"
                >
                  {shortName}{recommended ? " (추천)" : ""}
                </text>
              </g>
            );
          })}
          {hovered && (() => {
            const tooltipWidth = 270;
            const tooltipHeight = 174;
            const pointX = x(hovered.burden);
            const anchorY = pointY(hovered.margin);
            const tooltipX = pointX > RIGHT - tooltipWidth - 34 ? pointX - tooltipWidth - 30 : pointX + 30;
            const tooltipY = Math.max(TOP + 8, Math.min(BOTTOM - tooltipHeight, anchorY - tooltipHeight / 2));
            return (
              <foreignObject x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} className="cx-map-tooltip-wrap" aria-live="polite">
                <div className="cx-map-tooltip" role="status">
                  <strong>{hovered.name}</strong>
                  <span>성장 부담 <b>{signed(hovered.burden)}</b></span>
                  <small>최소 필요매출 {money(hovered.min_required_sales)}만원</small>
                  <span>예상 여유 <b>{signed(hovered.margin)}</b></span>
                  <small>ML 예상매출 {money(hovered.ml.predicted_monthly_sales)}만원</small>
                </div>
              </foreignObject>
            );
          })()}
        </svg>
      </div>
      <div className="cx-map-detail" aria-live="polite">
        <div className="cx-map-detail-head">
          <span>선택 후보</span>
          <strong>{selected.name}</strong>
          <p>{explain(selected)}</p>
        </div>
        <div className="cx-map-flow">
          <div><span>현재 매출</span><strong>{money(current)}만원</strong><small>비교 기준</small></div>
          <i aria-hidden="true">→</i>
          <div><span>최소 필요매출</span><strong>{money(selected.min_required_sales)}만원</strong><small>성장 부담 {signed(selected.burden)}</small></div>
          <i aria-hidden="true">→</i>
          <div className="is-predicted"><span>ML 예상매출</span><strong>{money(selected.ml.predicted_monthly_sales)}만원</strong><small>예상 여유 {signed(selected.margin)}</small></div>
        </div>
      </div>
    </div>
  );
}

function MoneyPanel({ data, candidate, rows }) {
  const coverage = candidate.initial_capital ? Math.min(100, candidate.available_self_fund / candidate.initial_capital * 100) : 100;
  return (
    <div className="cx-panel-stack">
      <section className="cx-section-card">
        <div className="cx-section-head"><div><h2>가진 돈으로 어디까지 가능한지 봐요</h2></div></div>
        <div className="cx-money-grid">
          <div className="cx-money-figure"><span>이전 소요자금</span><strong>{money(candidate.initial_capital)}<em>만원</em></strong><p>보증금 차액과 실제로 쓰는 이전비를 합친 금액이에요.</p></div>
          <div className="cx-fund-chart">
            <div><span>가용현금</span><strong>{money(candidate.available_self_fund)}만원</strong></div>
            <span className="cx-track"><span className="cx-fill good" style={{ width: `${coverage}%` }} /></span>
            <div><span>추가 필요</span><strong className={candidate.additional_fund_needed > 0 ? "cx-risk-text" : ""}>{money(candidate.additional_fund_needed)}만원</strong></div>
          </div>
        </div>
        <dl className="cx-breakdown">
          <div><dt>새로 묶이는 보증금</dt><dd>{money(candidate.net_deposit_change)}만원</dd></div>
          <div><dt>실제로 쓰는 이전비</dt><dd>{money(candidate.actual_relocation_cost)}만원</dd></div>
          <div><dt>매달 운영비 변화</dt><dd>{candidate.monthly_cost_delta > 0 ? `${money(candidate.monthly_cost_delta)}만원 더 들어요` : `${money(Math.abs(candidate.monthly_cost_delta))}만원 줄어요`}</dd></div>
        </dl>
      </section>

      <section className="cx-section-card">
        <div className="cx-section-head"><div><h2>언제까지 되찾고 싶은지에 따라 필요한 매출이 달라져요</h2></div></div>
        <div className="cx-period-list">
          {(candidate.target_periods || []).map((period) => (
            <div className={period.selected ? "is-selected" : ""} key={period.months}>
              <span>{period.months}개월</span><strong>{money(period.required_sales)}만원</strong><small>{period.selected ? "선택한 목표" : "월 필요매출"}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="cx-section-card cx-table-card">
        <div className="cx-section-head"><div><h2>같은 기준으로 나란히 비교해요</h2></div></div>
        <div className="cx-table-wrap"><table><thead><tr><th>후보</th><th>월 운영비</th><th>최소 필요매출</th><th>예상 매출</th><th>추가 자금</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.site_id}><th>후보 {row.site_id}</th><td>{money(row.monthly_operating_cost)}만원</td><td>{money(row.min_required_sales)}만원</td><td>{money(row.ml?.predicted_monthly_sales)}만원</td><td>{money(row.additional_fund_needed)}만원</td></tr>)}
        </tbody></table></div>
        <p className="cx-plain-note">현재 매출은 월 {money(data?.current_monthly_sales)}만원이에요.</p>
      </section>
    </div>
  );
}

function MarketPanel({ candidate, rows, places, selectedId }) {
  const observed = candidate.market_observed || {};
  const policies = candidate.policy_rag?.results || [];

  const mapCurrent = places?.current ? { ...places.current, label: "현재 매장" } : null;
  const mapCandidates = (rows || [])
    .map((row) => (places?.[row.site_id] ? { ...places[row.site_id], site_id: row.site_id, label: row.name } : null))
    .filter(Boolean);
  const hasPlaces = !!mapCurrent || mapCandidates.length > 0;

  return (
    <div className="cx-panel-stack">
      {hasPlaces && (
        <section className="cx-section-card">
          <div className="cx-section-head">
            <div><h2>지금 자리와 후보 자리를 지도에서 봐요</h2></div>
            <span className="cx-help"><MapPin size={14} aria-hidden="true" /> 상권 경계 표시</span>
          </div>
          <div className="cx-map-frame">
            <MapView current={mapCurrent} candidates={mapCandidates} selectedId={selectedId} showBoundaries />
          </div>
          <p className="cx-plain-note">색이 진할수록 순위가 높은 후보예요. 색만으로 구분하지 않도록 후보 기호도 함께 표시했어요.</p>
        </section>
      )}

      <section className="cx-section-card">
        <div className="cx-section-head"><div><h2>후보 지역의 최근 신호를 함께 봐요</h2></div><span className="cx-help">관측 데이터</span></div>
        <MarketTrendChart history={observed.sales_history} grain={observed.sales_history_grain} />
        <div className="cx-market-grid">
          <article><span>최근 폐업률</span><strong>{percent(observed.close_rate)}</strong><p>낮고 높은 것만으로 이전 여부를 정하지 않아요.</p></article>
          <article><span>전년동기 매출 변화</span><strong>{signed(observed.sales_yoy)}</strong><p>같은 분기와 비교한 상권 매출 변화예요.</p></article>
          <article><span>최근 매출 추세</span><strong>{observed.sales_trend || "확인 불가"}</strong><p>{Number.isFinite(observed.sales_trend_pct) ? `${signed(observed.sales_trend_pct)} 흐름으로 관측됐어요.` : "비교할 관측값이 없어요."}</p></article>
        </div>
      </section>

      <section className="cx-section-card">
        <div className="cx-section-head"><div><h2>부족한 자금을 채울 수 있는지 확인해요</h2></div></div>
        {policies.length ? <div className="cx-policy-list">{policies.map((policy, index) => (
          // 백엔드가 보내는 필드명은 name / application_status / amount_limit / interest_rate 다.
          // title, summary, status 로 읽으면 전부 undefined 라 폴백 문구만 남는다.
          <article key={`${policy.name}-${index}`}>
            <span>{policy.application_status || "자격 확인"}</span>
            <div>
              <strong>{policy.name}</strong>
              <p>
                {[policy.region_slot, policy.amount_limit && `한도 ${policy.amount_limit}`, policy.interest_rate && `금리 ${policy.interest_rate}`]
                  .filter(Boolean).join(", ") || "한도와 자격은 공고문에서 다시 확인해 주세요."}
              </p>
              <p className="cx-policy-note">{policy.eligibility_note}</p>
            </div>
            {policy.url
              ? <a href={policy.url} target="_blank" rel="noreferrer" aria-label={`${policy.name} 공식 공고 열기`}><ChevronRight size={19} aria-hidden="true" /></a>
              : <ChevronRight size={19} aria-hidden="true" />}
          </article>
        ))}</div> : <div className="cx-empty"><strong>바로 연결할 지원사업을 찾지 못했어요.</strong><p>사업장 소재지와 접수 시점에 따라 달라질 수 있어요.</p></div>}
        <p className="cx-plain-note">지원 가능 여부는 기관 심사에서 결정돼요. 신청 전 최신 공고를 확인해 주세요.</p>
      </section>
    </div>
  );
}

function MarketTrendChart({ history, grain }) {
  const points = (history || []).filter((item) => Number.isFinite(Number(item.monthly_sales)));
  const [activeIndex, setActiveIndex] = useState(Math.max(0, points.length - 1));
  if (points.length < 2) return <div className="cx-empty"><strong>분기별 흐름을 그릴 데이터가 부족해요.</strong><p>관측값이 두 분기 이상 쌓이면 그래프로 보여드려요.</p></div>;

  const w = 900;
  const h = 270;
  const margin = { left: 76, right: 24, top: 52, bottom: 42 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;
  const values = points.map((item) => Number(item.monthly_sales));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawRange = rawMax - rawMin || Math.max(rawMax * .1, 1);
  const axisMin = Math.max(0, rawMin - rawRange * .1);
  const axisMax = rawMax + rawRange * .1;
  const axisRange = axisMax - axisMin || 1;
  const x = (index) => margin.left + index / (points.length - 1) * plotW;
  const y = (value) => margin.top + plotH - (value - axisMin) / axisRange * plotH;
  const path = points.map((item, index) => `${index ? "L" : "M"}${x(index)},${y(item.monthly_sales)}`).join(" ");
  const active = points[Math.min(activeIndex, points.length - 1)];
  const activeX = x(Math.min(activeIndex, points.length - 1));
  const tooltipX = activeX > w - 230 ? activeX - 212 : activeX + 12;
  const quarter = (value) => `${String(value).slice(0, 4)} Q${Number(String(value).slice(4))}`;
  const ticks = Array.from({ length: 5 }, (_, index) => axisMin + axisRange * index / 4);

  function moveToPointer(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewX = (event.clientX - rect.left) / rect.width * w;
    const ratio = Math.max(0, Math.min(1, (viewX - margin.left) / plotW));
    setActiveIndex(Math.round(ratio * (points.length - 1)));
  }

  function moveWithKeyboard(event) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(points.length - 1, index + 1));
    }
  }

  return (
    <div className="cx-trend-chart">
      <div className="cx-trend-chart-head"><span>분기별 월평균 매출</span><small>{grain === "district" ? "자치구 단위 실측값이에요" : "실측값이에요"}</small></div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        role="img"
        tabIndex="0"
        aria-label={`${quarter(active.quarter)} 월평균 매출 ${money(active.monthly_sales)}만원`}
        onPointerMove={moveToPointer}
        onPointerDown={moveToPointer}
        onKeyDown={moveWithKeyboard}
      >
        {ticks.map((tick, index) => {
          const yy = y(tick);
          return <g key={index}><line x1={margin.left} x2={w - margin.right} y1={yy} y2={yy} className="cx-trend-grid" /><text x={margin.left - 12} y={yy + 4} textAnchor="end" className="cx-trend-y">{money(Math.round(tick))}만</text></g>;
        })}
        <path d={path} className="cx-trend-path" />
        {points.map((item, index) => <circle key={item.quarter} cx={x(index)} cy={y(item.monthly_sales)} r={index === activeIndex ? 6 : 4} className={index === activeIndex ? "cx-trend-point is-active" : "cx-trend-point"} />)}
        <g className="cx-trend-guide" style={{ transform: `translateX(${activeX}px)` }} aria-hidden="true"><line y1={margin.top} y2={margin.top + plotH} /></g>
        <g transform={`translate(${tooltipX} 8)`} className="cx-trend-tooltip" aria-hidden="true">
          <rect width="200" height="48" rx="6" />
          <text x="14" y="19">{quarter(active.quarter)}</text>
          <text x="14" y="37">{money(active.monthly_sales)}만원</text>
        </g>
        <text x={margin.left} y={h - 12} textAnchor="start" className="cx-trend-x">{quarter(points[0].quarter)}</text>
        <text x={w - margin.right} y={h - 12} textAnchor="end" className="cx-trend-x">{quarter(points[points.length - 1].quarter)}</text>
      </svg>
      <p>그래프 위에서 움직이거나 좌우 방향키를 누르면 분기별 값을 볼 수 있어요.</p>
    </div>
  );
}
