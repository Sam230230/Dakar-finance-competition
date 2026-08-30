import { useMemo, useState } from "react";
import MapView from "./MapView";
import {
  money, signed,
  salesBufferLine, monthlyCostDeltaLine, capitalLine, recoveryTargetLine,
  relativeToBestOtherLine, recoveryRelevanceLabel, fundPriorityLine,
} from "./insights";

const SITE_COLOR = { current: "#111111", A: "#ff5c35", B: "#2357ff", C: "#7d5cff" };

function modeLabel(mode) {
  return mode === "growth_opportunity" ? "성장·기회 관점" : "비용·회복 관점";
}
function statusTone(status) {
  if (status === "접수 중") return "tone-live";
  if (status === "접수 예정") return "tone-soon";
  if (status === "오늘 마감" || status === "마감") return "tone-closed";
  return "tone-check";
}
function selectedTargetPeriod(c) {
  return (c?.target_periods || []).find((t) => t.months === Number(c?.target_months)) || null;
}

export default function ResultScreen({ data, places, onRestart, aiState }) {
  const rows = data?.candidates || [];
  const ranking = data?.ranking || { ranking: rows.map((r) => r.site_id), recommended_candidate: rows[0]?.site_id, confidence: "conditional", reasons: {} };
  const overall = data?.overall || null;
  const [selectedId, setSelectedId] = useState(ranking.recommended_candidate || rows[0]?.site_id || "A");
  const selected = rows.find((x) => x.site_id === selectedId) || rows[0] || {};

  const mapCurrent = places?.current ? { ...places.current, label: "현재 매장" } : null;
  const mapCandidates = rows.map((c) => (places?.[c.site_id] ? { ...places[c.site_id], site_id: c.site_id, label: c.name } : null)).filter(Boolean);

  // ML 예측이 아니라 market_observed(실측값) — 이미 %/%p 단위라 scale:1로 비교한다.
  const closureBySite = useMemo(
    () => Object.fromEntries(rows.map((c) => [c.site_id, c.market_observed?.close_rate])),
    [rows]
  );
  const yoyBySite = useMemo(
    () => Object.fromEntries(rows.map((c) => [c.site_id, c.market_observed?.sales_yoy])),
    [rows]
  );
  const trendBySite = useMemo(
    () => Object.fromEntries(rows.map((c) => [c.site_id, c.market_observed?.sales_trend_pct])),
    [rows]
  );

  const aiFailed = aiState === "error";
  const recommendedReason = ranking.reasons?.[ranking.recommended_candidate] || {};

  return (
    <main className="result-page">
      <ResultHero
        ranking={ranking} overall={overall} aiFailed={aiFailed}
        recommendedReason={recommendedReason} onRestart={onRestart}
        selectedId={selectedId} onSelect={setSelectedId}
      />

      <SalesComparisonChart rows={rows} />

      <ComparisonMatrix rows={rows} />

      <section className="page-width">
        <div className="section-heading"><div><span className="eyebrow">DETAIL</span><h2>선택 후보 상세</h2></div><p>후보를 선택해 조건을 자세히 비교하세요</p></div>
        <nav className="candidate-tabs">
          {rows.map((c) => (
            <button key={c.site_id} className={selectedId === c.site_id ? "active" : ""} onClick={() => setSelectedId(c.site_id)}>
              <i style={{ background: SITE_COLOR[c.site_id] }} />후보 {c.site_id}
              <small>{modeLabel(c.analysis_mode)}</small>
            </button>
          ))}
        </nav>

        <div className="result-map-section">
          <div className="map-frame result-map-frame"><MapView current={mapCurrent} candidates={mapCandidates} selectedId={selectedId} showBoundaries /></div>
          <aside className="result-place-card">
            <span className="eyebrow">LOCATION</span>
            <div className="place-badge" style={{ background: SITE_COLOR[selectedId] }}>{selectedId}</div>
            <h2>{selected.name}</h2>
            <p>{selected.analysis_mode === "growth_opportunity" ? "현재보다 월 반복비용을 더 부담하면서 옮길 만한 조건인지 봅니다." : "월 비용을 낮추면서 이전비를 얼마나 안정적으로 회수할 수 있는지 봅니다."}</p>
          </aside>
        </div>

        <div className="kpi-ribbon">
          <KpiCard index="01" label="후보 월 운영비" value={`${money(selected.monthly_operating_cost)}만원`} line={monthlyCostDeltaLine(selected.monthly_cost_delta)} />
          <KpiCard index="02" label="최소 필요 월매출" value={`${money(selected.min_required_sales)}만원`} line={salesBufferLine(selected.ml?.predicted_monthly_sales, selected.min_required_sales)} emphasis />
          <KpiCard index="03" label="초기 이전 소요자금" value={`${money(selected.initial_capital)}만원`} line={capitalLine(selected.initial_capital, selected.additional_fund_needed)} />
          {selected.target_months != null && (
            <KpiCard
              index="04"
              label={`${selected.target_months}개월 회수 목표${selected.recovery_relevance === "secondary" ? " (참고)" : ""}`}
              value={selectedTargetPeriod(selected) ? `${money(selectedTargetPeriod(selected).required_sales)}만원` : "-"}
              line={recoveryTargetLine(selected.ml?.predicted_monthly_sales, selectedTargetPeriod(selected)?.required_sales)}
            />
          )}
        </div>
      </section>

      <MlSection candidate={selected} closureBySite={closureBySite}
        yoyBySite={yoyBySite} trendBySite={trendBySite} />

      <PolicySection candidate={selected} />

      <AiSection rows={rows} selected={selected} overall={overall} comparisonSummary={data?.comparison_summary}
        aiFailed={aiFailed} />

      <AssumptionsAccordion assumptions={data?.assumptions} mlMetrics={selected?.ml?.metrics} />

      <section className="page-width result-footer-action">
        <span>다른 후보를 비교하려면 처음으로 돌아가세요.</span>
        <button type="button" onClick={onRestart}>새 분석 ↗</button>
      </section>

      <PerfFooter performance={data?.performance} />
    </main>
  );
}

function ResultHero({ ranking, overall, aiFailed, recommendedReason, onRestart, selectedId, onSelect }) {
  const conditional = ranking.confidence === "conditional";
  const allBelowThreshold = !!ranking.all_below_threshold;
  // 전원 미달일 때는 LLM 헤드라인도 무시하고 강하게 확정하지 않는 문구로 고정한다.
  const headline = allBelowThreshold
    ? "현재 조건에서는 모든 후보가 최소 사업성 기준에 미치지 못합니다."
    : overall?.headline || (conditional
        ? `현재 조건에서는 후보 ${ranking.recommended_candidate}가 상대적으로 유리합니다.`
        : `후보 ${ranking.recommended_candidate}가 가장 유리합니다.`);
  const subline = allBelowThreshold ? `후보 ${ranking.recommended_candidate}가 상대적으로 기준에 가장 가깝습니다.` : null;
  const rankLabel = (i) => (allBelowThreshold ? `상대적 ${i + 1}순위` : `${i + 1}순위`);

  // 값의 실제 부호에 맞는 문구/아이콘 — "-6.4% 여유"처럼 부호를 무시하고 항상 긍정으로
  // 표시하던 버그를 고친다. tone이 "warn"이면 체크가 아니라 주의 아이콘으로 렌더링한다.
  const checks = [];
  if (recommendedReason.sales_buffer_ratio != null) {
    const r = recommendedReason.sales_buffer_ratio * 100;
    checks.push(r >= 0
      ? { text: `최소 필요매출 대비 +${r.toFixed(1)}% 여유`, tone: "ok" }
      : { text: `최소 필요매출 대비 ${Math.abs(r).toFixed(1)}% 부족`, tone: "warn" });
  }
  if (recommendedReason.meets_recovery_target != null) {
    checks.push(recommendedReason.meets_recovery_target
      ? { text: "목표 회수기간 충족 가능", tone: "ok" }
      : { text: "목표 회수기간 기준 매출 부족", tone: "warn" });
  }
  if (recommendedReason.additional_fund_needed != null) {
    checks.push(recommendedReason.additional_fund_needed <= 0
      ? { text: "추가 필요 이전자금 0원", tone: "ok" }
      : { text: `추가 필요 이전자금 ${money(recommendedReason.additional_fund_needed)}만원`, tone: "warn" });
  }

  return (
    <section className="result-hero page-width">
      <div className="result-hero-top">
        <div>
          <span className="eyebrow">분석 완료</span>
          <h1 className="result-title-sentence">{headline}</h1>
          {subline && <p className="result-conditional-note">{subline}</p>}
          {!allBelowThreshold && conditional && <p className="result-conditional-note">모든 후보가 최소 조건을 완전히 충족하지는 않아 조건부 비교 결과입니다.</p>}
        </div>
        <button type="button" className="micro-button" onClick={onRestart}>다시 분석</button>
      </div>
      <nav className="rank-badges" aria-label="후보 순위 · 선택해서 아래 상세 보기">
        {ranking.ranking.map((siteId, i) => (
          <button
            key={siteId}
            type="button"
            className={`rank-badge${i === 0 ? " rank-1" : ""}${selectedId === siteId ? " is-selected" : ""}`}
            onClick={() => onSelect(siteId)}
          >
            <i style={{ background: SITE_COLOR[siteId] }} />{rankLabel(i)} · 후보 {siteId}
          </button>
        ))}
      </nav>
      {checks.length > 0 && (
        <ul className="hero-checks">{checks.map((c, i) => <li key={i} className={c.tone === "warn" ? "is-warn" : ""}>{c.tone === "warn" ? "⚠" : "✓"} {c.text}</li>)}</ul>
      )}
      {(aiFailed || overall?.main_risk) && (
        <p className="hero-risk">
          {aiFailed ? "AI 해석을 불러오지 못했습니다. 계산·검색 결과만 표시합니다." : `⚠ ${overall.main_risk}`}
        </p>
      )}
    </section>
  );
}

function KpiCard({ index, label, value, line, emphasis }) {
  return (
    <article className={emphasis ? "kpi-card emphasis" : "kpi-card"}>
      <span>{index}</span>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{line}</small>
    </article>
  );
}

const COMPARE_ROWS = [
  { label: "월 운영비", render: (c) => `${money(c.monthly_operating_cost)}만원`, sub: (c) => monthlyCostDeltaLine(c.monthly_cost_delta) },
  { label: "최소 필요 월매출", render: (c) => `${money(c.min_required_sales)}만원` },
  { label: "ML 예상 월매출(모델 추정)", render: (c) => c.ml?.predicted_monthly_sales != null ? `${money(c.ml.predicted_monthly_sales)}만원` : "확인 불가" },
  { label: "매출 여유", render: (c) => salesBufferLine(c.ml?.predicted_monthly_sales, c.min_required_sales) },
  { label: "초기 이전 소요자금", render: (c) => `${money(c.initial_capital)}만원` },
  { label: "추가 필요 이전자금", render: (c) => `${money(c.additional_fund_needed)}만원`, sub: (c) => capitalLine(c.initial_capital, c.additional_fund_needed) },
  {
    label: "목표 회수기간",
    render: (c) => c.target_months != null ? `${c.target_months}개월 · ${recoveryRelevanceLabel(c.recovery_relevance)}` : "-",
  },
  { label: "최근 폐업률(실측)", render: (c) => c.market_observed?.close_rate != null ? `${c.market_observed.close_rate}%` : "확인 불가" },
  { label: "자치구 매출 추세(실측)", render: (c) => c.market_observed?.sales_trend ? `${c.market_observed.sales_trend}${c.market_observed.sales_trend_pct != null ? ` (${signed(c.market_observed.sales_trend_pct)}%)` : ""}` : "확인 불가" },
  { label: "전년동기 매출 변화(실측)", render: (c) => c.market_observed?.sales_yoy != null ? `${signed(c.market_observed.sales_yoy)}%` : "확인 불가" },
  { label: "정책금융 활용도", render: (c) => policyUtilizationLabel(c.policy_rag) },
];

/** "N건" 하나로 뭉개지 않고, 후보가 실제로 얼마나 활용 가능한지 상태별로 센다. */
function policyUtilizationLabel(rag) {
  const results = rag?.results || [];
  const historical = rag?.historical || [];
  const direct = results.filter((p) => !p.eligibility_needs_check).length;
  const needsCheck = results.length - direct;
  const parts = [];
  if (direct > 0) parts.push(`직접 활용 후보 ${direct}건`);
  if (needsCheck > 0) parts.push(`조건 확인 ${needsCheck}건`);
  if (historical.length > 0) parts.push(`지난 회차 참고 ${historical.length}건`);
  return parts.length ? parts.join(" · ") : "확인된 정책금융 없음";
}

/** GRAPH 1 — 최소필요/목표회수/ML예상 매출 그룹 막대. 실제 Rule/ML 값만 사용, 장식 없음. */
function SalesComparisonChart({ rows }) {
  const withSales = rows.filter((c) => c.min_required_sales != null);
  if (!withSales.length) return null;
  const series = [
    { key: "min", label: "최소 필요매출", color: "#111111" },
    { key: "target", label: "목표 회수 필요매출", color: "#7d5cff" },
    { key: "predicted", label: "ML 예상매출", color: "#2357ff" },
  ];
  const values = (c) => ({
    min: c.min_required_sales,
    target: selectedTargetPeriod(c)?.required_sales ?? null,
    predicted: c.ml?.predicted_monthly_sales ?? null,
  });
  const maxValue = Math.max(
    1,
    ...withSales.flatMap((c) => Object.values(values(c)).filter((v) => v != null))
  );

  // viewBox 좌표계로 그려서 width:100%로 컨테이너 폭에 정확히 맞춘다 —
  // 남는 여백도, 눈금/숫자 잘림도 생기지 않는다(고정 px 캔버스를 쓰지 않음).
  const chartH = 200;
  const marginLeft = 56;
  const marginTop = 12;
  const marginBottom = 30;
  const barW = 26;
  const groupGap = 40;
  const groupW = series.length * barW + 8;
  const plotW = Math.max(withSales.length * (groupW + groupGap), 240);
  const viewW = marginLeft + plotW + 16;
  const viewH = marginTop + chartH + marginBottom;

  return (
    <section className="page-width sales-chart-section">
      <div className="section-heading">
        <div><span className="eyebrow">GRAPH</span><h2>후보별 필요매출 vs ML 예상매출</h2></div>
        <p>단위: 만원 · Rule Engine 계산값 + ML 추정치(실험적)</p>
      </div>
      <div className="sales-chart-legend">
        {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <div className="sales-chart-card">
        <svg viewBox={`0 0 ${viewW} ${viewH}`} width="100%" height={viewH} role="img"
          aria-label="후보별 최소 필요매출, 목표 회수 필요매출, ML 예상매출 비교 막대그래프">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = marginTop + chartH - chartH * t;
            return (
              <g key={t}>
                <line x1={marginLeft} x2={viewW - 8} y1={y} y2={y} stroke="rgba(17,17,17,.08)" />
                <text x={marginLeft - 8} y={y + 3} fontSize="10" fill="#6f706c" textAnchor="end">{money(Math.round(maxValue * t))}만</text>
              </g>
            );
          })}
          {withSales.map((c, gi) => {
            const gx = marginLeft + gi * (groupW + groupGap) + groupGap / 2;
            const v = values(c);
            return (
              <g key={c.site_id}>
                {series.map((s, si) => {
                  const val = v[s.key];
                  if (val == null) return null;
                  const h = (val / maxValue) * chartH;
                  return (
                    <rect key={s.key} x={gx + si * barW} y={marginTop + chartH - h} width={barW - 4} height={h} fill={s.color} rx="3">
                      <title>{`후보 ${c.site_id} · ${s.label}: ${money(val)}만원`}</title>
                    </rect>
                  );
                })}
                <text x={gx + groupW / 2 - 5} y={marginTop + chartH + 22} fontSize="13" fontWeight="800" textAnchor="middle" fill="#111">{c.site_id}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

/** 실제 자치구 동종업종 분기별 매출 추이(라인차트) — 상권(TRDAR)이 아니라 자치구 단위 실측
 * 시계열임을 라벨에 명시한다(상권 단위 다분기 매출 데이터가 없어 대체할 수 없음). */
function DistrictSalesHistoryChart({ history, grain }) {
  if (!history || history.length < 2) return null;
  const w = 640, h = 160, margin = { left: 56, right: 16, top: 12, bottom: 26 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;
  const values = history.map((p) => p.monthly_sales);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const x = (i) => margin.left + (i / (history.length - 1)) * plotW;
  const y = (v) => margin.top + plotH - ((v - min) / range) * plotH;
  const path = history.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.monthly_sales)}`).join(" ");
  const fmtQ = (q) => `${String(q).slice(0, 4)} Q${String(q).slice(4)}`;

  return (
    <div className="district-trend-card">
      <div className="scenario-title">
        <strong>{grain === "district" ? "자치구 동종업종 분기별 매출 추이" : "분기별 매출 추이"}</strong>
        <span>실측 시계열{grain === "district" ? " · 자치구 단위(상권 단위 다분기 데이터 없음)" : ""}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="자치구 동종업종 분기별 매출 추이">
        <line x1={margin.left} x2={w - margin.right} y1={margin.top + plotH} y2={margin.top + plotH} stroke="rgba(17,17,17,.15)" />
        <text x={margin.left - 8} y={y(max) + 3} fontSize="9" fill="#6f706c" textAnchor="end">{money(Math.round(max))}만</text>
        <text x={margin.left - 8} y={y(min) + 3} fontSize="9" fill="#6f706c" textAnchor="end">{money(Math.round(min))}만</text>
        <path d={path} fill="none" stroke="#2357ff" strokeWidth="2" />
        {history.map((p, i) => (
          <g key={p.quarter}>
            <circle cx={x(i)} cy={y(p.monthly_sales)} r="3" fill="#2357ff">
              <title>{`${fmtQ(p.quarter)} · ${money(p.monthly_sales)}만원`}</title>
            </circle>
            {(i === 0 || i === history.length - 1) && (
              <text x={x(i)} y={h - 6} fontSize="9" fill="#6f706c" textAnchor={i === 0 ? "start" : "end"}>{fmtQ(p.quarter)}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function ComparisonMatrix({ rows }) {
  if (!rows.length) return null;
  return (
    <section className="page-width compare-section">
      <div className="section-heading"><div><span className="eyebrow">COMPARE</span><h2>후보 비교</h2></div><p>순위나 종합점수 없이 값만 비교합니다</p></div>
      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th>구분</th>
              {rows.map((c) => (
                <th key={c.site_id}><span className="compare-th-badge" style={{ background: SITE_COLOR[c.site_id] }}>{c.site_id}</span>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                {rows.map((c) => (
                  <td key={c.site_id}>
                    <div>{row.render(c)}</div>
                    {row.sub && <small>{row.sub(c)}</small>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="compare-cards">
        {rows.map((c) => (
          <article key={c.site_id} className="compare-card-mobile">
            <div className="compare-card-mobile-head"><span style={{ background: SITE_COLOR[c.site_id] }}>{c.site_id}</span>{c.name}</div>
            {COMPARE_ROWS.map((row) => (
              <div key={row.label} className="compare-card-mobile-row">
                <span>{row.label}</span>
                <div><b>{row.render(c)}</b>{row.sub && <small>{row.sub(c)}</small>}</div>
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}

function MlSection({ candidate, closureBySite, yoyBySite, trendBySite }) {
  const ml = candidate?.ml;
  const observed = candidate?.market_observed;
  const targetPeriods = candidate?.target_periods || [];
  const scenarios = candidate?.scenarios || [];
  const isReal = ml?.model_source === "real";
  return (
    <section className="market-section">
      <div className="page-width">
        <div className="section-heading"><div><span className="eyebrow">ML</span><h2>ML 상권 분석</h2></div><p>모델 추정 vs 실제 관측값 · 후보 상대비교</p></div>
        {!ml || ml.status === "error" ? <p>ML 결과를 불러오지 못했습니다.</p> : (
          <>
            {ml.caution && (
              <div className={isReal ? "ml-info-banner" : "ml-caution-banner"}>{isReal ? "" : "⚠ "}{ml.caution}</div>
            )}
            <div className="ml-groups">
              <div className="ml-group">
                <span className="ml-group-title">예상 성과 (모델 추정치)</span>
                <div className="ml-metric">
                  <span>동종업종 점포당 예상 월매출</span>
                  <strong>{ml.predicted_monthly_sales != null ? `${money(ml.predicted_monthly_sales)}만원` : "-"}</strong>
                  <small>{salesBufferLine(ml.predicted_monthly_sales, candidate.min_required_sales)}</small>
                  <small className="ml-source-tag">{isReal ? `서울시 실제 상권 데이터 기반 ${ml.model_name} · ${ml.data_completeness === "trdar_exact" ? "이 상권 실측 배분" : "자치구 평균 대체"}` : "⚠ 합성 데이터 fallback"}</small>
                </div>
              </div>
              <div className="ml-group">
                <span className="ml-group-title">실제 상권 지표 (관측값)</span>
                {observed?.status === "ok" ? (
                  <>
                    <div className="ml-metric"><span>최근 폐업률</span><strong>{observed.close_rate != null ? `${observed.close_rate}%` : "-"}</strong><small>{relativeToBestOtherLine(candidate.site_id, closureBySite, { lowerIsBetter: true, unit: "%p", decimals: 1 }) || "비교 대상 없음"}</small></div>
                    <div className="ml-metric"><span>최근 개업률</span><strong>{observed.open_rate != null ? `${observed.open_rate}%` : "-"}</strong></div>
                    <div className="ml-metric"><span>전년동기 매출 변화</span><strong>{observed.sales_yoy != null ? `${signed(observed.sales_yoy)}%` : "-"}</strong><small>{relativeToBestOtherLine(candidate.site_id, yoyBySite, { lowerIsBetter: false, unit: "%p", decimals: 1 }) || "비교 대상 없음"}</small></div>
                    <div className="ml-metric"><span>평균 영업기간</span><strong>{observed.avg_open_months != null ? `${observed.avg_open_months}개월` : "-"}</strong></div>
                  </>
                ) : (
                  <p className="ml-no-snapshot">이 상권은 실측 스냅샷이 없어 관측 지표를 표시할 수 없습니다.</p>
                )}
              </div>
              <div className="ml-group">
                <span className="ml-group-title">추세 (관측값)</span>
                <div className="ml-metric"><span>자치구 동종업종 매출 추세</span><strong>{observed?.sales_trend ? `${observed.sales_trend}${observed.sales_trend_pct != null ? ` (${signed(observed.sales_trend_pct)}%)` : ""}` : "-"}</strong><small>{relativeToBestOtherLine(candidate.site_id, trendBySite, { lowerIsBetter: false, unit: "%p", decimals: 1 }) || "비교 대상 없음"}</small></div>
              </div>
            </div>
            <DistrictSalesHistoryChart history={observed?.sales_history} grain={observed?.sales_history_grain} />
          </>
        )}

        {(targetPeriods.length > 0 || scenarios.length > 0) && (
          <div className="scenario-grid">
            <div className="scenario-card">
              <div className="scenario-title"><strong>기간 → 필요매출</strong><span>Rule Engine 계산값</span></div>
              <p className="scenario-caption">x축: 회수 목표기간(개월) · y축(막대 길이): 현재 매출 대비 필요 유지율 · 막대 옆 숫자: 그 기간에 필요한 월매출(만원)</p>
              {targetPeriods.map((t) => {
                const isBaseline = t.months === Number(candidate?.target_months);
                return (
                  <div className={`scenario-row${isBaseline ? " is-baseline" : ""}`} key={t.months}>
                    <span>{t.months}<small>개월</small></span>
                    <div className="scenario-bar"><i style={{ width: `${Math.min(100, t.required_retention * 100)}%` }} /></div>
                    <b>{money(t.required_sales)}만</b>
                    {isBaseline && <em className="baseline-tag">내 목표</em>}
                  </div>
                );
              })}
            </div>
            <div className="scenario-card dark-scenario">
              <div className="scenario-title"><strong>매출 유지율 → 회수기간</strong><span>Rule Engine 계산값</span></div>
              <p className="scenario-caption">x축: 현재 매출 대비 유지율(%) · y축(막대 길이): 유지율 자체 · 막대 옆 숫자: 그 유지율에서 예상되는 회수기간(개월)</p>
              {scenarios.map((s) => (
                <div className="scenario-row" key={s.retention}>
                  <span>{Math.round(s.retention * 100)}<small>%</small></span>
                  <div className="scenario-bar"><i style={{ width: `${Math.min(100, s.retention * 100)}%` }} /></div>
                  <b>{s.payback_months == null ? "회수 어려움" : `${s.payback_months}개월`}</b>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function PolicySection({ candidate }) {
  const rag = candidate?.policy_rag || {};
  const policies = (rag.results || []).slice(0, 3);
  const aiPolicySummary = candidate?.ai_explanation?.policy_summary || [];
  const whyRelevantByName = Object.fromEntries(aiPolicySummary.map((p) => [p.policy_name, p.why_relevant]));
  const commonChecks = policies.filter((p) => p.eligibility_needs_check || rag.status !== "ok").length > 0;

  return (
    <section className="policy-section">
      <div className="page-width">
        <div className="section-heading">
          <div><span className="eyebrow">POLICY RAG</span><h2>{candidate?.candidate_region ? `${candidate.candidate_region}에서 확인할 정책금융` : "정책금융"}</h2></div>
          <p>Rule Engine의 추가 필요 이전자금 + 후보 자치구 기준, 최대 3건</p>
        </div>
        <p className="policy-priority-summary">{fundPriorityLine(rag.fund_priority)}</p>
        {policies.length ? (
          <div className="policy-grid">
            {policies.map((p, i) => (
              <article className="policy-card" key={`${p.name}-${i}`}>
                <div className="policy-card-head">
                  <span>{p.region_slot}</span>
                  <span className={`status-badge ${statusTone(p.application_status)}`}>{p.application_status}</span>
                  <b>{p.support_type}</b>
                </div>
                <h3>{p.name}</h3>
                <p>{p.agency}</p>
                {whyRelevantByName[p.name] && <p className="policy-why">{whyRelevantByName[p.name]}</p>}
                <dl>
                  <div><dt>자금용도</dt><dd>{p.fund_use}</dd></div>
                  <div><dt>지원한도</dt><dd>{p.amount_limit}</dd></div>
                  <div><dt>금리</dt><dd>{p.interest_rate}</dd></div>
                  <div><dt>업력</dt><dd>{p.business_age_requirement}</dd></div>
                </dl>
                <div className="policy-card-foot">
                  <span className={p.eligibility_needs_check ? "needs-check" : "ok-check"}>{p.eligibility_note}</span>
                  {p.url && <a href={p.url} target="_blank" rel="noreferrer">공식 공고 ↗</a>}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="policy-empty">{rag.message || "현재 조건에서 직접적으로 추천할 정책금융을 찾지 못했습니다."}</div>
        )}
        {commonChecks && (
          <div className="policy-warning">
            <p>※ 정책지원 후보가 검색되어도 지원금이 확보된 것으로 계산하지 않습니다. 실제 지원 여부는 해당 기관 심사를 통해 결정됩니다.</p>
            <p>※ 지원한도는 공고상 최대 지원한도이며 실제 승인금액과 다를 수 있습니다.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function AiSection({ rows, selected, overall, comparisonSummary, aiFailed }) {
  return (
    <section className="ai-explanation-section">
      <div className="page-width">
        <div className="section-heading">
          <div><span className="eyebrow">AI SUMMARY</span><h2>AI 종합 해석</h2></div>
          <p>Rule Engine 계산 결과 + 검색된 정책 근거만 이용해 생성 · 확정 승인·추천이 아닙니다</p>
        </div>
        {aiFailed || !selected?.ai_explanation ? (
          <p className="ai-explanation-card">AI 해석을 불러오지 못해 계산·검색 결과만 표시합니다.</p>
        ) : (
          <>
            <div className="ai-explanation-card ai-quad">
              <div><h4>한줄 결론</h4><p>{selected.ai_explanation.one_line_summary}</p></div>
              <div><h4>좋은 점</h4><ul className="ai-policy-list">{(selected.ai_explanation.strengths || []).map((s, i) => <li key={i}>{s}</li>)}</ul></div>
              <div><h4>주의할 점</h4><ul className="ai-checks-list">{(selected.ai_explanation.risks || []).map((r, i) => <li key={i}>{r}</li>)}</ul></div>
              <div><h4>선택 조건</h4><p>{selected.ai_explanation.decision_condition}</p></div>
            </div>
            {selected.ai_explanation.important_checks?.length > 0 && (
              <div className="checks">{selected.ai_explanation.important_checks.map((x, i) => <span key={i}>확인 · {x}</span>)}</div>
            )}
            {rows.length > 1 && comparisonSummary && (
              <div className="ai-comparison-card"><h4>후보 간 차이</h4><p>{comparisonSummary}</p></div>
            )}
            {overall?.reason && (
              <p className="ai-grounding-note">{overall.reason}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function AssumptionsAccordion({ assumptions, mlMetrics }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="page-width insight-section">
      <button type="button" className="assumptions-toggle" onClick={() => setOpen((v) => !v)}>
        분석 기준 및 주의사항 {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="insight-copy">
          <p>ML 결과는 모델 추정치이며 Rule Engine의 확정 계산값을 대체하지 않습니다.</p>
          {mlMetrics && (
            <p>ML 모델 참고 오차(Test 기준): MAE 약 {money(mlMetrics.mae)}만원, sMAPE {mlMetrics.smape}%, R² {mlMetrics.r2} — 자치구 단위 분기 매출 예측 기준 수치입니다.</p>
          )}
          <p>정책 정보는 공식 공고 기준이며, 자격·신청상태는 실제 신청 전 다시 확인이 필요합니다.</p>
          <p>최종 추천은 입력값과 현재 데이터 기준으로 계산된 것이며 확정 승인을 의미하지 않습니다.</p>
          {(assumptions || []).map((a, i) => <p key={i}>{a}</p>)}
        </div>
      )}
    </section>
  );
}

function PerfFooter({ performance }) {
  if (!performance) return null;
  return (
    <section className="page-width perf">
      <b>실행시간</b>
      <span>Rule+ML+RAG {performance.analysis_seconds ?? "-"}s</span>
      <span>RAG {performance.rag_retrieval_seconds ?? "-"}s</span>
      <span>ML {performance.ml_inference_seconds ?? "-"}s</span>
      <span>LLM {performance.llm_seconds ?? "-"}s · {performance.llm_calls ?? 0}회</span>
      <span>전체 {performance.total_seconds ?? "-"}s</span>
    </section>
  );
}
