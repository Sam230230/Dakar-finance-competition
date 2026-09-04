import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Coins,
  HandCoins,
  Info,
  Landmark,
  MapPin,
  Percent,
  RotateCcw,
  Scale,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Dot,
  Label,
  LabelList,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import MapView from "../MapView";

/**
 * 차트에 넘기는 색은 CSS 토큰을 읽을 수 없어 여기 모아 둔다.
 * 값은 codex-result.css 의 .cx-report 토큰과 짝이 맞아야 한다.
 * 메인 초록(brand)은 추천 후보를 가리킬 때만 쓴다. 나머지 후보는 연한 초록이나
 * 중립 회색에 점선을 얹어 가른다 (색만으로 구분하지 않기 위해서다).
 */
const CHART = {
  brand: "#02c551",        // 추천 후보 전용
  brandSoft: "rgba(2,197,81,.45)", // 추천이 아닌 후보. 같은 브랜드 초록을 옅게 깔아 구분한다
  green: "#02c551",        // 글자와 선에 쓰는 초록
  risk: "#c0272c",
  neutral: "#8a919b",
  baselineBar: "#c9ccd0",
  step1: "#e2e5ea",
  step2: "#8a919b",
  grid: "#e7e8ea",
  axis: "#c9ccd0",
  label: "#5b6168",
  weak: "#6c737d",
  ink: "#121619",
  onDarkWeak: "#c7ccd4",
  white: "#ffffff",
};

/** 후보 하나를 가리키는 색. 추천만 메인 초록을 가져간다. */
const candidateColor = (isRecommended) => (isRecommended ? CHART.brand : CHART.neutral);

/**
 * 좁은 칸에 들어가는 작은 그림 세 종류.
 *
 * 한때 recharts 로 그렸는데 되돌렸다. ResponsiveContainer 는 부모 폭을 재서 자기 폭을 정하는데,
 * 그리드 칸이 줄어들 때 다시 재지 않는다. 좁은 레이아웃(1열)에서 넓은 레이아웃(4열)으로 가면
 * 좁을 때의 폭(588px)을 그대로 들고 있어 페이지에 가로 스크롤이 최대 322px 생겼다.
 * 리렌더가 일어나야 회복돼서, 창 크기를 바꾼 사용자에게는 깨진 채로 남았다.
 *
 * 셋 다 값을 길이나 위치로 옮기는 게 전부라 차트 엔진이 할 일이 없다. CSS 로 그리면
 * 폭 계산을 브라우저가 하므로 이 문제가 사라진다.
 */

/** 값 하나를 길이로 보여주는 한 칸 막대. */
function MiniBar({ value, max, color, height = 14, label }) {
  const safe = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const limit = Number(max) > 0 ? Number(max) : 1;
  const pct = Math.min(100, (safe / limit) * 100);
  return (
    <div className="cx-mini-chart cx-mini-bar" role="img" aria-label={label} style={{ height }}>
      <span className="cx-mini-bar-track" style={{ height: Math.max(4, height - 6) }}>
        <span className="cx-mini-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </span>
    </div>
  );
}

/** 여러 조각을 이어 붙인 한 줄 막대. 합계에서 각 조각이 차지하는 몫을 본다. */
function MiniStack({ segments = [], total, height = 16, label }) {
  const sum = Number(total) > 0
    ? Number(total)
    : segments.reduce((acc, seg) => acc + Math.max(0, Number(seg.value) || 0), 0) || 1;
  return (
    <div className="cx-mini-chart cx-mini-stack" role="img" aria-label={label} style={{ height }}>
      {segments.map((seg) => (
        <span
          key={seg.key}
          style={{ width: `${(Math.max(0, Number(seg.value) || 0) / sum) * 100}%`, background: seg.color }}
        />
      ))}
    </div>
  );
}

/** 서울시 상권변화지표는 0~1 연속값이 아니라 HH/LH/HL/LL 네 분류다.
 *  그래서 눈금 네 칸짜리 가로 막대에 점 하나만 찍는다 — 왼쪽일수록 점포 교체가
 *  느려 예측 가능하고(안정), 오른쪽일수록 진입·퇴출이 빨라 변동이 크다(불안정). */
function StabilityScale({ position, color, label }) {
  const last = CHANGE_SCALE.length - 1;
  return (
    <div className="cx-mini-chart cx-stability" role="img" aria-label={label}>
      <span className="cx-stability-rail">
        {CHANGE_SCALE.map((code, index) => (
          <i key={code} className="cx-stability-tick" style={{ left: `${(index / last) * 100}%` }} />
        ))}
        {position !== null && (
          <i className="cx-stability-dot" style={{ left: `${(position / last) * 100}%`, background: color }} />
        )}
      </span>
    </div>
  );
}
import { hasValue, headcount, money, percent, scaledWon, signed } from "./format";

// 탭 하나가 질문 하나에 답한다. 이름만 보고 안에 무엇이 있는지 알 수 있게 나눈다.
//   상권 정보  이 동네가 어떤 곳인지   (실측 관측값만)
//   매출 전망  얼마 벌고 얼마 필요한지 (예상매출과 필요매출을 나란히)
//   이전 자금  옮기는 데 돈이 되는지   (소요자금과 그 돈을 메울 정책금융)
//   종합 판단  그래서 어디로 갈지     (해석과 후보 비교)
// 아이콘은 이미 import 된 것으로 고른다 — 탭 하나 때문에 번들이 늘 이유가 없다.
const TABS = [
  { id: "market", label: "상권 정보", Icon: Building2 },
  { id: "sales", label: "매출 전망", Icon: TrendingUp },
  { id: "money", label: "이전 자금", Icon: Wallet },
  { id: "summary", label: "종합 판단", Icon: Scale },
];

function quarterMonths(value, compact = false) {
  const text = String(value);
  const year = text.slice(0, 4);
  const quarter = Number(text.slice(-1));
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return compact
    ? `${year.slice(2)}년 ${startMonth}~${endMonth}월`
    : `${year}년 ${startMonth}월~${endMonth}월`;
}

/** 오늘이 속한 분기를 YYYYQ 로. 공공데이터는 몇 분기 늦게 공개되므로
 *  "추정"이 미래인지 아직 안 들어온 과거인지 판별하려면 현재 시점이 필요하다. */
function currentQuarter(now = new Date()) {
  return now.getFullYear() * 10 + Math.floor(now.getMonth() / 3) + 1;
}

/** 분기 간 거리. 20261 에서 20263 이면 2. */
function quarterGap(from, to) {
  const idx = (q) => Math.floor(Number(q) / 10) * 4 + (Number(q) % 10);
  return idx(to) - idx(from);
}

/**
 * 데이터가 지금보다 얼마나 뒤처져 있는지 한 줄로.
 * 서울시 상권분석서비스는 분기 마감 뒤 여러 달 지나 공개돼서, 예측 대상 분기가
 * 이미 지나간 과거일 수 있다. 그걸 "추정"이라고만 적어 두면 미래로 읽힌다.
 */
function dataRecencyNote(basisQuarter, targetQuarter) {
  if (!hasValue(basisQuarter)) return null;
  const now = currentQuarter();
  const base = `공개된 실적은 ${quarterMonths(basisQuarter)}까지예요.`;
  if (!hasValue(targetQuarter)) return base;
  // 예측 대상이 이미 지난 분기면 "앞날"이 아니라 데이터 공백이다. 그대로 말한다.
  return quarterGap(targetQuarter, now) > 0
    ? `${base} 옅은 구간은 앞날이 아니라 아직 집계 전인 분기예요.`
    : `${base} 옅은 구간은 다음 분기 추정이에요.`;
}

function salesState(candidate) {
  const predicted = Number(candidate?.ml?.predicted_monthly_sales);
  const required = Number(candidate?.min_required_sales);
  if (!Number.isFinite(predicted) || !Number.isFinite(required) || !required) return null;
  return { predicted, required, ratio: predicted / required, gap: predicted - required };
}

export default function CodexResultScreen({ data, places, aiState, onRestart = () => {} }) {
  const rows = data?.candidates || [];
  const recommendedId = data?.ranking?.recommended_candidate || rows[0]?.site_id;
  const [selectedId, setSelectedId] = useState(recommendedId);
  const [tab, setTab] = useState(TABS[0].id);
  // 후보 카드를 눌러 보라는 첫 안내. 상권 정보 탭은 후보를 바꿔도 내용이 같아서 띄우지 않는다.
  // 저장하지 않고 화면 상태로만 둬서 새로고침하면 다시 뜬다 (온보딩 트랙 안내와 같은 방식).
  const [coachOff, setCoachOff] = useState(false);
  const showCoach = !coachOff && tab !== "market" && rows.length > 1;
  const selected = rows.find((row) => row.site_id === selectedId) || rows[0] || {};
  const rankingReason = data?.ranking?.reasons?.[selected.site_id] || {};
  const state = salesState(selected);
  const mapCurrent = places?.current ? { ...places.current, label: "현재 매장" } : null;
  const mapCandidates = rows
    .map((row) => (places?.[row.site_id] ? { ...places[row.site_id], site_id: row.site_id, label: row.name } : null))
    .filter(Boolean);
  const hasPlaces = !!mapCurrent || mapCandidates.length > 0;

  const drivers = useMemo(() => {
    const lift = data?.current_monthly_sales
      ? (selected.min_required_sales / data.current_monthly_sales - 1) * 100
      : null;
    const payback = selected.scenarios?.[0];
    const monthlyGain = Number(payback?.monthly_gain);
    const paybackMonths = Number(payback?.payback_months);
    const paybackYears = Number.isFinite(paybackMonths) ? Math.round(paybackMonths / 12) : null;
    return [
      {
        label: "필요한 매출 변화",
        value: lift == null ? "확인 불가" : lift <= 0
          ? <><b>{Math.abs(lift).toFixed(1)}%</b> 낮아도 돼요</>
          : <><b>{lift.toFixed(1)}%</b> 더 필요해요</>,
        detail: `현재 ${money(data?.current_monthly_sales)}만원에서 최소 ${money(selected.min_required_sales)}만원이 필요해요.`,
      },
      {
        label: "추가로 마련할 돈",
        value: selected.additional_fund_needed > 0
          ? <><b>{money(selected.additional_fund_needed)}만원</b> 필요해요</>
          : "지금 가진 돈으로 가능해요",
        detail: `이전 소요자금 ${money(selected.initial_capital)}만원 중 ${money(selected.available_self_fund)}만원을 바로 쓸 수 있어요.`,
      },
      {
        label: "회수 예상",
        value: Number.isFinite(monthlyGain) && monthlyGain > 0
          ? <><b>월 {money(monthlyGain)}만원</b> 더 남아요</>
          : "매달 남는 돈이 늘지 않아요",
        detail: paybackYears === null
          ? "실제 이전비를 회수할 수 있는 개선액이 아직 없어요."
          : `실제 이전비를 회수하는 데 약 ${paybackYears}년 걸려요.`,
        formula: Number.isFinite(monthlyGain) && monthlyGain > 0 && Number.isFinite(paybackMonths)
          ? { monthlyGain }
          : null,
      },
    ];
  }, [data, selected]);

  return (
    <main className="cx-report">
      <header className="cx-topbar">
        <a className="cx-brand" href="#top" aria-label="Stay or Move 결과지 맨 위로">stay or move</a>
        <p>후보지 분석 결과</p>
        <button type="button" onClick={onRestart}><RotateCcw size={15} /> 다시 분석</button>
      </header>

      <div className="cx-shell" id="top">
        <section className="cx-result-shelf" aria-labelledby="result-title">
          <div className="cx-title-row">
            <div>
              <h1 id="result-title">어느 자리가 가장 현실적인지 비교했어요</h1>
            </div>
            <p className="cx-updated">입력한 금액은 만원 기준</p>
          </div>

          <div className={`cx-top-dashboard ${hasPlaces ? "" : "without-map"}`}>
            {hasPlaces && (
              <section className="cx-location-card" aria-labelledby="location-map-title">
                <div className="cx-section-head">
                  <div><h2 id="location-map-title">지금 자리와 후보 자리를 지도에서 봐요</h2></div>
                  <span className="cx-help"><MapPin size={15} aria-hidden="true" /> 상권 경계 표시</span>
                </div>
                <div className="cx-map-frame">
                  <MapView current={mapCurrent} candidates={mapCandidates} selectedId={selected.site_id} showBoundaries />
                </div>
                <p className="cx-data-source">출처: 네이버 지도, 서울시 상권영역 데이터</p>
              </section>
            )}

            <div className="cx-candidate-col">
              {showCoach && (
                <div className="cx-coach" role="note">
                  <span>카드를 눌러 <b>다른 자리도 볼 수 있어요</b></span>
                  <button
                    type="button"
                    className="cx-coach-close"
                    onClick={() => setCoachOff(true)}
                    title="다시 보지 않기"
                    aria-label="안내 끄기"
                  >
                    <X size={15} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                </div>
              )}
            {/* 행 수를 후보 수에 맞춘다. 3행 고정이면 후보가 1~2곳일 때 빈 행이 남는다.
                후보가 적을 때는 카드를 지도 높이만큼 늘리지 않고 위로 붙인다 */}
            <div
              className={`cx-candidate-list${rows.length < 3 ? " is-sparse" : ""}`}
              style={{ "--n": rows.length }}
            >
              {rows.map((candidate) => {
                const active = candidate.site_id === selected.site_id;
                const candidateState = salesState(candidate);
                return (
                  <button
                    className={`cx-candidate ${active ? "is-active" : ""}`}
                    key={candidate.site_id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => { setCoachOff(true); setSelectedId(candidate.site_id); }}
                  >
                    <span className="cx-candidate-top">
                      <span className="cx-candidate-code">후보 {candidate.site_id}</span>
                      {candidate.site_id === recommendedId && <span className="cx-recommend">추천 후보</span>}
                    </span>
                    <strong className="cx-place">{candidate.name}</strong>
                    <span className="cx-card-foot">
                      <span className={`cx-card-state ${candidateState?.gap >= 0 ? "is-good" : "is-risk"}`}>
                        {candidateState?.gap >= 0
                          ? <Check size={15} strokeWidth={2.2} aria-hidden="true" />
                          : <CircleAlert size={15} strokeWidth={2.2} aria-hidden="true" />}
                        {candidateState?.gap >= 0 ? "상권 평균 충족" : "상권 평균 미달"}
                      </span>
                      <ChevronRight size={18} aria-hidden="true" />
                    </span>
                  </button>
                );
              })}
            </div>
            </div>
          </div>
        </section>

        {/* 후보 비교 탭(.cx-nvc-tabs)과 같은 규약을 쓴다. 한 화면에서 같은 일을 하는 컨트롤이
            스크린리더에 다르게 읽히면 안 된다. aria-current="page" 는 페이지 이동용이라 여기엔 맞지 않는다. */}
        <div className="cx-tabs" role="tablist" aria-label="결과 분석 범위">
          {TABS.map((item, index) => (
            <button
              key={item.id}
              id={`cx-tab-${item.id}`}
              className={tab === item.id ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`cx-panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                const step = event.key === "ArrowRight" ? 1 : TABS.length - 1;
                const next = TABS[(index + step) % TABS.length];
                setTab(next.id);
                event.currentTarget.parentElement
                  ?.querySelectorAll("button")
                  [(index + step) % TABS.length]?.focus();
              }}
              onClick={() => setTab(item.id)}
            >
              <item.Icon size={17} strokeWidth={2.1} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>

        {tab !== "market" && (
          <section className="cx-guide" aria-label="결과 읽는 법">
            <Info size={20} aria-hidden="true" />
            <div>
              <strong>후보 {selected.site_id}의 결과를 보고 있어요.</strong>
              <p>추천 여부보다 예상 매출, 필요한 돈, 회수기간이 내 상황에 맞는지 먼저 확인해 주세요.</p>
            </div>
          </section>
        )}

        {tab === "summary" && (
          <div role="tabpanel" id="cx-panel-summary" aria-labelledby="cx-tab-summary">
          <SummaryPanel
            data={data}
            candidate={selected}
            state={state}
            drivers={drivers}
            rankingReason={rankingReason}
            rows={rows}
            aiState={aiState}
            onSelect={setSelectedId}
          />
          </div>
        )}
        {tab === "sales" && (
          <div role="tabpanel" id="cx-panel-sales" aria-labelledby="cx-tab-sales">
          <SalesPanel data={data} candidate={selected} rows={rows} recommendedId={recommendedId} places={places} />
          </div>
        )}
        {tab === "money" && (
          <div role="tabpanel" id="cx-panel-money" aria-labelledby="cx-tab-money">
            <MoneyPanel data={data} candidate={selected} rows={rows} />
          </div>
        )}
        {tab === "market" && (
          <div role="tabpanel" id="cx-panel-market" aria-labelledby="cx-tab-market">
            <MarketPanel candidate={selected} rows={rows} recommendedId={recommendedId} places={places} />
          </div>
        )}

        <section className="cx-bottom-action">
          <div>
            <p>입력한 조건이 달라지면 결과도 달라져요.</p>
            <strong>임대료나 가용현금을 바꿔 다시 비교할 수 있어요.</strong>
          </div>
          <button type="button" onClick={onRestart}>조건 바꿔보기 <ArrowUpRight size={15} /></button>
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
          <article className="is-risk">
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

      {overall?.main_risk && (
        <p className="cx-ai-risk">
          <CircleAlert size={15} strokeWidth={2.2} aria-hidden="true" />
          <span>{overall.main_risk}</span>
        </p>
      )}

      {checks.length > 0 && (
        <div className="cx-ai-checks">
          <h3>직접 확인할 것</h3>
          <ul>
            {checks.map((item, i) => (
              <li key={i}><Check size={15} strokeWidth={2.2} aria-hidden="true" /><span>{item}</span></li>
            ))}
          </ul>
        </div>
      )}

      {overall?.reason && <p className="cx-plain-note">{overall.reason}</p>}
    </section>
  );
}

/**
 * 판 돈에서 얼마가 손에 남는지. 지금 매장과 나란히 놓아 옮기면 나아지는지 갈리게 한다.
 *
 *   남는 몫 = (예상매출 × 공헌이익률 − 후보 고정비) / 예상매출
 *
 * 전에 쓰던 "판단 여유"(예상매출이 최소 필요매출을 넘는 폭)는 오해를 불렀다.
 * 여유가 2.2%뿐이라 위태로워 보이는 자리가 실제로는 지금보다 이익이 큰 경우가 있다.
 */
/** 나란히 보기 막대의 툴팁. 값은 막대 위에 이미 적혀 있으니,
 *  여기서는 그 막대가 무엇을 세는 값인지와 상대편과의 차이를 말한다. */
function NowVsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="cx-rechart-tooltip">
      <span>{label}</span>
      <strong>{money(Math.round(row.value))}만원</strong>
      {row.caption ? <small>{row.caption}</small> : null}
      {row.diffText ? <small>{row.diffText}</small> : null}
    </div>
  );
}

/**
 * 지금 매장 하나와 후보 한 곳을 나란히 세운다.
 *
 * 전에는 후보 A·B·C를 0선 위에 겹쳐 그렸다. 그러면 "후보끼리 누가 나은가"는 보여도
 * 정작 쓰는 사람이 묻는 "지금 5,200만원 팔던 내가 저기 가면 어떻게 되는가"가 화면에 없다.
 *
 * 지표마다 축이 완전히 다르다(유지비 550 vs 매출 5,200). 한 그래프에 넣으면 작은 쪽이
 * 뭉개지므로, 지표별로 작은 세로 막대를 따로 세우고 그 안에서만 지금:후보를 견준다.
 * 왼쪽 회색 막대(지금)는 후보를 바꿔도 그대로라, 움직이는 것이 곧 차이가 된다.
 *
 * 탭은 상단 후보 카드와 같은 selectedId 를 쓴다. 선택 상태를 따로 두면 두 곳이 어긋난다.
 */
function NowVsCandidate({ data, rows = [], selectedId, onSelect, recommendedId }) {
  const candidate = rows.find((row) => row.site_id === selectedId) || rows[0];
  if (!candidate) return null;

  const cm = Number(data?.contribution_margin_rate);
  const nowSales = Number(data?.current_monthly_sales);
  const nowFixed = Number(data?.current_monthly_fixed_cost);
  const nowProfit = Number(data?.current_operating_profit);
  const candFixed = Number(candidate.monthly_operating_cost);
  const candNeed = Number(candidate.min_required_sales);
  const predicted = Number(candidate.ml?.predicted_monthly_sales);
  // 후보에서 손에 남는 돈 = 상권 평균 매출 × 공헌이익률 − 후보 유지비.
  // 변동비율은 지금과 같다고 본다(같은 업종 이전) — 계산 엔진의 가정과 맞춘다.
  const candProfit = Number.isFinite(predicted) && Number.isFinite(cm)
    ? predicted * cm - candFixed
    : NaN;

  const metrics = [
    { key: "cost", label: "매달 나가는 유지비", now: nowFixed, cand: candFixed, betterDown: true },
    { key: "need", label: "벌어야 하는 매출", now: nowSales, cand: candNeed, betterDown: true,
      nowCaption: "지금 파는 액수", candCaption: "최소 필요매출" },
    { key: "left", label: "손에 남는 돈", now: nowProfit, cand: candProfit, betterDown: false,
      note: "상권 평균 기준" },
  ].filter((metric) => Number.isFinite(metric.now) && Number.isFinite(metric.cand));

  if (!metrics.length) return null;

  const capital = Number(candidate.initial_capital);
  const ownFund = Number(candidate.available_self_fund);
  const shortfall = Number(candidate.additional_fund_needed);

  return (
    <div className="cx-nvc">
      {/* 후보가 한 곳뿐이면 전환할 대상이 없어 탭 줄 자체를 두지 않는다 */}
      {rows.length > 1 && (
        <div className="cx-nvc-tabs" role="tablist" aria-label="비교할 후보 선택" style={{ "--n": rows.length }}>
          {rows.map((row, index) => (
            <button
              key={row.site_id}
              type="button"
              role="tab"
              aria-selected={row.site_id === candidate.site_id}
              tabIndex={row.site_id === candidate.site_id ? 0 : -1}
              onKeyDown={(event) => {
                // role=tablist 는 좌우 화살표 이동이 규약이다
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                const step = event.key === "ArrowRight" ? 1 : rows.length - 1;
                const next = rows[(index + step) % rows.length];
                onSelect?.(next.site_id);
                event.currentTarget.parentElement
                  ?.querySelectorAll("button")
                  [(index + step) % rows.length]?.focus();
              }}
              onClick={() => onSelect?.(row.site_id)}
            >
              후보 {row.site_id}{row.site_id === recommendedId ? " 추천" : ""}
              <small>{row.name}</small>
            </button>
          ))}
        </div>
      )}

      <div className="cx-nvc-grid">
        {metrics.map((metric) => {
          const diff = metric.cand - metric.now;
          const good = metric.betterDown ? diff < 0 : diff > 0;
          const gapText = diff === 0
            ? "지금과 같아요"
            : `지금보다 ${money(Math.abs(Math.round(diff)))}만원 ${diff > 0 ? "많아요" : "적어요"}`;
          const bars = [
            { name: "지금", value: Math.max(0, metric.now), caption: metric.nowCaption },
            {
              name: `후보 ${candidate.site_id}`,
              value: Math.max(0, metric.cand),
              caption: metric.candCaption || metric.note,
              diffText: gapText,
            },
          ];
          const top = Math.max(bars[0].value, bars[1].value) || 1;

          return (
            <section className="cx-nvc-cell" key={metric.key}>
              <header>
                <p>{metric.label}{metric.note ? <em>{metric.note}</em> : null}</p>
                <strong className={diff === 0 ? "" : good ? "is-good" : "is-bad"}>
                  {diff === 0 ? "같아요" : `${diff > 0 ? "+" : "−"}${money(Math.abs(Math.round(diff)))}만원`}
                </strong>
              </header>
              <div
                className="cx-rechart cx-nvc-rechart"
                role="img"
                aria-label={`${metric.label} — 지금 ${money(Math.round(metric.now))}만원, 후보 ${candidate.site_id} ${money(Math.round(metric.cand))}만원`}
              >
                <ResponsiveContainer width="100%" height={196}>
                  <BarChart data={bars} margin={{ top: 26, right: 6, bottom: 4, left: 6 }}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="4 4" />
                    <Tooltip
                      content={<NowVsTooltip />}
                      cursor={{ fill: "rgba(18,22,25,.035)" }}
                      isAnimationActive={false}
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: CHART.label, fontSize: 12.5, fontWeight: 700 }}
                      axisLine={{ stroke: CHART.axis }}
                      tickLine={false}
                    />
                    {/* 지표마다 축이 다르므로 눈금값은 숨기고 막대 위 숫자로 읽게 한다 */}
                    <YAxis hide domain={[0, top * 1.2]} />
                    <Bar dataKey="value" barSize={54} radius={[6, 6, 0, 0]} isAnimationActive={false}>
                      <Cell fill={CHART.neutral} />
                      <Cell fill={good ? CHART.brand : CHART.risk} />
                      <LabelList
                        dataKey="value"
                        position="top"
                        offset={9}
                        fill={CHART.ink}
                        fontSize={14}
                        fontWeight={800}
                        formatter={(value) => money(Math.round(value))}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {metric.nowCaption && (
                <p className="cx-nvc-caption">
                  <span>{metric.nowCaption}</span>
                  <span>{metric.candCaption}</span>
                </p>
              )}
            </section>
          );
        })}
      </div>

      {Number.isFinite(capital) && (
        <p className="cx-nvc-fund">
          후보 {candidate.site_id}로 옮기는 데 <b>{money(capital)}만원</b>이 들어요.
          {Number.isFinite(ownFund) && Number.isFinite(shortfall) && shortfall > 0
            ? <> 가진 <b>{money(ownFund)}만원</b>을 빼면 <b>{money(shortfall)}만원</b>을 더 마련해야 해요.</>
            : <> 지금 가진 돈으로 가능해요.</>}
        </p>
      )}
    </div>
  );
}

function MarginCard({ data, candidate, fallbackBuffer }) {
  const margin = Number(data?.contribution_margin_rate);
  const predicted = Number(candidate?.ml?.predicted_monthly_sales);
  const fixed = Number(candidate?.candidate_fixed_cost);
  const nowSales = Number(data?.current_monthly_sales);
  const nowProfit = Number(data?.current_operating_profit);

  const usable = [margin, predicted, fixed, nowSales, nowProfit].every(Number.isFinite)
    && margin > 0 && predicted > 0 && nowSales > 0;

  if (!usable) {
    return (
      <aside className="cx-verdict-aside">
        <span>판단 여유</span>
        <strong>{fallbackBuffer == null ? "확인 불가" : percent(fallbackBuffer * 100)}</strong>
        <p>상권 평균 예상매출이 최소 필요매출을 넘는 폭이에요.</p>
      </aside>
    );
  }

  const nextKeep = ((predicted * margin - fixed) / predicted) * 100;
  const nowKeep = (nowProfit / nowSales) * 100;
  const worse = nextKeep < nowKeep;
  const clamp = (v) => Math.max(0, Math.min(100, v));

  const rows = [
    { key: "now", label: "지금 매장", pct: nowKeep, tone: " is-now" },
    { key: "next", label: `후보 ${candidate.site_id}로 옮기면`, pct: nextKeep, tone: "" },
  ];

  return (
    <aside className="cx-verdict-aside">
      <span>예상 남는 몫</span>
      <strong className={worse ? "is-risk" : ""}>{percent(nextKeep)}</strong>
      <div className="cx-margin-rows">
        {rows.map((row) => (
          <div className="cx-margin-row" key={row.key}>
            <div className="cx-margin-lab"><span>{row.label}</span><em>{percent(row.pct)}</em></div>
            <MiniStack
              total={100}
              label={`${row.label} 판 돈의 ${percent(row.pct)}가 손에 남아요`}
              segments={[
                { key: "cost", value: clamp(100 - row.pct), color: CHART.step2 },
                { key: "keep", value: clamp(row.pct), color: row.key === "now" ? CHART.brandSoft : CHART.green },
              ]}
            />
          </div>
        ))}
      </div>
      <div className="cx-margin-legend">
        <span><i className="is-cost" />나가는 돈</span>
        <span><i className="is-keep" />손에 남는 돈</span>
      </div>
    </aside>
  );
}

/** 회수 예상의 핵심인 월 개선액이 어떻게 산정됐는지만 설명한다. */
function PaybackFormulaInfo({ formula }) {
  const [open, setOpen] = useState(false);
  if (!formula) return null;

  return (
    <span className="cx-payback-info">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`회수 예상 계산 방법 ${open ? "접기" : "보기"}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Info size={15} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {open && (
        <span className="cx-payback-pop" role="note">
          <strong>후보 매장 영업이익<em>추정</em> − 현재 영업이익 = 월 {money(formula.monthlyGain)}만원</strong>
        </span>
      )}
    </span>
  );
}

function SummaryPanel({ data, candidate, state, drivers, rankingReason, rows, aiState, onSelect }) {
  const headline = candidate.site_id === data?.ranking?.recommended_candidate
    ? data?.overall?.headline || `후보 ${candidate.site_id}가 가장 현실적이에요.`
    : `후보 ${candidate.site_id}의 조건을 자세히 살펴볼게요.`;
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
              {state?.gap >= 0 ? `상권 평균이 기준보다 ${money(state.gap)}만원 높아요` : `상권 평균이 기준보다 ${money(Math.abs(state?.gap))}만원 부족해요`}
            </span>
            <span className={candidate.additional_fund_needed > 0 ? "is-risk" : "is-good"}>
              {candidate.additional_fund_needed > 0 ? <CircleAlert size={15} /> : <Check size={15} />}
              {candidate.additional_fund_needed > 0 ? `추가로 ${money(candidate.additional_fund_needed)}만원이 필요해요` : "추가 자금이 필요하지 않아요"}
            </span>
          </div>
          <p className="cx-data-source">출처: 서울 열린데이터 광장</p>
        </div>
        <MarginCard data={data} candidate={candidate} fallbackBuffer={buffer} />
      </section>

      <AiInsight candidate={candidate} overall={data?.overall} aiState={aiState} />

      <section className="cx-section-card" aria-labelledby="decision-drivers">
        <div className="cx-section-head">
          <div><h2 id="decision-drivers">이 세 가지를 먼저 보세요</h2></div>
          <span className="cx-help">현재 조건 기준</span>
        </div>
        <ul className="cx-driver-list">
          {drivers.map((driver) => (
            <li key={driver.label}>
              <div>
                <p>{driver.label}{driver.formula && <PaybackFormulaInfo formula={driver.formula} />}</p>
                <strong>{driver.value}</strong>
                <span>{driver.detail}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="cx-section-card">
        <div className="cx-section-head">
          <div><h2>지금 매장과 나란히 놓고 봐요</h2></div>
          <span className="cx-help">회색이 지금</span>
        </div>
        <NowVsCandidate
          data={data}
          rows={rows}
          selectedId={candidate.site_id}
          onSelect={onSelect}
          recommendedId={data?.ranking?.recommended_candidate}
        />
        <p className="cx-data-source">출처: 서울 열린데이터 광장</p>
      </section>
    </div>
  );
}

function RecoveryTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="cx-rechart-tooltip">
      <span>{label}개월 회수 기준</span>
      <strong>월 {money(Math.round(payload[0].value))}만원</strong>
    </div>
  );
}

function RecoveryDot({ cx, cy, payload, selectedMonth }) {
  if (payload?.month !== selectedMonth) return null;
  return <Dot cx={cx} cy={cy} r={6} fill={CHART.green} stroke="#ffffff" strokeWidth={2.2} />;
}

function RecoveryPointLabel({ x, y, index, selectedIndex, months, sales }) {
  if (index !== selectedIndex) return null;
  return (
    <g transform={`translate(${x - 76} ${y - 68})`}>
      <rect width="152" height="52" rx="8" fill="#121619" />
      <text x="13" y="21" fill={CHART.onDarkWeak} fontSize="12" fontWeight="650">온보딩 입력 {months}개월</text>
      <text x="13" y="40" fill="#ffffff" fontSize="15" fontWeight="800">월 {money(Math.round(sales))}만원</text>
    </g>
  );
}

function RecoveryMonthTick({ x, y, payload, selectedMonth }) {
  const selected = payload?.value === selectedMonth;
  return (
    <g transform={`translate(${x} ${y})`}>
      {selected && <rect x="-25" y="6" width="50" height="24" rx="7" fill="#121619" />}
      <text x="0" y="22" textAnchor="middle" fill={selected ? "#ffffff" : CHART.label} fontSize="12" fontWeight={selected ? 800 : 650}>{payload?.value}개월</text>
    </g>
  );
}

function RecoveryCurve({ data, candidate, pickedMonths }) {
  const arc = Number(candidate?.actual_relocation_cost);
  const fixed = Number(candidate?.candidate_fixed_cost);
  const profit = Number(data?.current_operating_profit);
  const margin = Number(data?.contribution_margin_rate);

  const usable = [arc, fixed, profit, margin].every(Number.isFinite) && margin > 0 && arc > 0;
  if (!usable) return null;

  const months = Number(pickedMonths) || 24;
  const M0 = 6;
  const M1 = 60;
  const need = (m) => (arc / m + fixed + profit) / margin;
  const value = need(months);
  const chartData = Array.from({ length: M1 - M0 + 1 }, (_, index) => {
    const month = M0 + index;
    return { month, sales: need(month) };
  });
  const values = chartData.map((point) => point.sales);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const range = rawMax - rawMin || 1;
  const yDomain = [Math.max(0, rawMin - range * .08), rawMax + range * .08];
  const ticks = [6, 12, 24, 36, 48, 60];

  return (
    <div className="cx-curve" role="img" aria-label={`온보딩에서 정한 ${months}개월 안에 회수하려면 매달 ${money(Math.round(value))}만원의 매출이 필요해요`}>
      <div className="cx-chart-kpis">
        <div><span>회수 목표기간</span><strong>{months}개월</strong></div>
        <div><span>매달 필요한 매출</span><strong>{money(Math.round(value))}만원</strong></div>
      </div>
      <div className="cx-rechart cx-recovery-rechart">
        <ResponsiveContainer width="100%" height={350}>
          <ComposedChart data={chartData} margin={{ top: 72, right: 14, bottom: 16, left: 12 }}>
            <defs>
              <linearGradient id="resultRecoveryFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART.brand} stopOpacity="0.28" />
                <stop offset="100%" stopColor={CHART.brand} stopOpacity="0.03" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART.grid} strokeDasharray="4 4" />
            <ReferenceArea x1={months - 2} x2={months + 2} fill={CHART.brand} fillOpacity={0.1} stroke="none" />
            <XAxis type="number" dataKey="month" domain={[M0, M1]} ticks={ticks} interval={0} tick={<RecoveryMonthTick selectedMonth={months} />} axisLine={{ stroke: CHART.axis }} tickLine={false} height={54}>
              <Label value="회수 목표기간" position="insideBottom" offset={0} fill={CHART.label} fontSize={12} fontWeight={750} />
            </XAxis>
            <YAxis type="number" domain={yDomain} orientation="right" tickFormatter={(tick) => `${money(Math.round(tick))}만`} tick={{ fill: CHART.label, fontSize: 12, fontWeight: 650 }} axisLine={false} tickLine={false} width={72} />
            <Tooltip content={<RecoveryTooltip isAnimationActive={false} />} cursor={{ stroke: CHART.green, strokeWidth: 1.5, strokeDasharray: "4 4" }} />
            <Area type="monotone" dataKey="sales" name="필요 월매출" stroke="none" fill="url(#resultRecoveryFill)" isAnimationActive={false} />
            <Line type="monotone" dataKey="sales" name="필요 월매출" stroke={CHART.green} strokeWidth={4} dot={(props) => <RecoveryDot {...props} selectedMonth={months} />} activeDot={{ r: 6, fill: CHART.green, stroke: "#ffffff", strokeWidth: 2 }} isAnimationActive={false}>
              <LabelList content={(props) => <RecoveryPointLabel {...props} selectedIndex={months - M0} months={months} sales={value} />} />
            </Line>
            <ReferenceLine segment={[{ x: M0, y: value }, { x: months, y: value }]} stroke={CHART.green} strokeWidth={2.2} strokeDasharray="5 5" />
            <ReferenceLine segment={[{ x: months, y: yDomain[0] }, { x: months, y: value }]} stroke={CHART.green} strokeWidth={2.2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="cx-chart-static-note">회수 목표기간은 온보딩 입력값이에요. 결과 화면에서는 변경하지 않아요.</p>
    </div>
  );
}

/**
 * 매출 전망 탭. 얼마 벌 것 같은지와 얼마 벌어야 하는지를 한 화면에 둔다.
 * 이 둘의 비교가 이전 여부를 가르는 핵심인데, 전에는 서로 다른 탭에 흩어져 있었다.
 */
/**
 * 최소 필요매출이 왜 그 숫자인지 분해해 보여준다.
 *
 *   최소 필요매출 = 팔면서 나가는 돈 + 매장 유지비 + 손에 남는 돈
 *
 * 지금 매장과 나란히 쌓으면, 손에 남는 돈을 그대로 지키려고 매출을 더 올려야 하는
 * 이유가 "유지비가 늘었기 때문"이라는 게 길이로 읽힌다. 숫자만 두 개 놓을 때는
 * 그 인과가 화면 어디에도 없었다.
 */
function BreakdownTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="cx-rechart-tooltip">
      <span>{label}</span>
      {payload.map((entry) => (
        <div className="cx-rechart-tooltip-row" key={entry.dataKey}>
          <i style={{ background: entry.color }} />
          <b>{entry.name}</b>
          <strong>{money(Math.round(entry.value))}만원</strong>
        </div>
      ))}
    </div>
  );
}

function RequirementBreakdown({ data, candidate, current, required, lift }) {
  const margin = Number(data?.contribution_margin_rate);
  const keep = Number(data?.current_operating_profit);
  const nowFixed = Number(data?.current_monthly_fixed_cost);
  const nextFixed = Number(candidate?.candidate_fixed_cost);

  const usable = [current, required, margin, keep, nowFixed, nextFixed].every(Number.isFinite)
    && margin > 0 && margin < 1 && current > 0 && required > 0;

  if (!usable) {
    return (
      <div className="cx-sales-pair">
        <div>
          <span>지금 매출</span>
          <strong>{money(current)}만원</strong>
          <small>비교 기준이에요</small>
        </div>
        <i aria-hidden="true">→</i>
        <div className="is-required">
          <span>최소 필요매출</span>
          <strong>{money(required)}만원</strong>
          <small>
            {lift == null ? "확인 불가"
              : lift <= 0 ? `${Math.abs(lift).toFixed(1)}% 낮아도 지금 수익을 지켜요`
              : `${lift.toFixed(1)}% 더 팔아야 지금 수익을 지켜요`}
          </small>
        </div>
      </div>
    );
  }

  const axis = Math.max(current, required);
  const rows = [
    { key: "now", label: "지금 매장", total: current, variable: current * (1 - margin), fixed: nowFixed, keep },
    { key: "next", label: `후보 ${candidate.site_id}로 옮기면`, total: required, variable: required * (1 - margin), fixed: nextFixed, keep },
  ];
  const fixedDelta = nextFixed - nowFixed;
  const salesDelta = required - current;

  return (
    <div className="cx-breakdown-chart">
      <div className="cx-rechart cx-breakdown-rechart" role="img" aria-label={rows.map((row) => `${row.label} 총매출 ${money(Math.round(row.total))}만원`).join(", ")}>
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 86, bottom: 8, left: 4 }} barCategoryGap={22}>
            <CartesianGrid horizontal={false} stroke={CHART.grid} strokeDasharray="4 4" />
            <XAxis type="number" domain={[0, axis * 1.04]} hide />
            <YAxis type="category" dataKey="label" width={126} axisLine={false} tickLine={false} tick={{ fill: CHART.ink, fontSize: 12, fontWeight: 750 }} />
            <Tooltip content={<BreakdownTooltip isAnimationActive={false} />} cursor={{ fill: "rgba(2,197,81,.05)" }} />
            <Bar dataKey="variable" name="팔면서 나가는 돈" stackId="total" fill={CHART.step1} radius={[8, 0, 0, 8]} isAnimationActive={false} />
            <Bar dataKey="fixed" name="매장 유지비" stackId="total" fill={CHART.step2} isAnimationActive={false} />
            <Bar dataKey="keep" name="손에 남는 돈" stackId="total" fill={CHART.green} radius={[0, 8, 8, 0]} isAnimationActive={false}>
              <LabelList dataKey="total" position="right" formatter={(value) => `${money(Math.round(value))}만원`} fill="#121619" fontSize={13} fontWeight={800} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="cx-bd-legend">
        <span><i className="is-variable" />팔면서 나가는 돈</span>
        <span><i className="is-fixed" />매장 유지비</span>
        <span><i className="is-keep" />손에 남는 돈</span>
        <small>단위는 만원이에요</small>
      </div>

      <p className="cx-bd-why">
        {Math.abs(fixedDelta) < 1
          ? "매장 유지비가 지금과 비슷해서 필요한 매출도 크게 달라지지 않아요."
          : fixedDelta > 0
            ? `매장 유지비가 매달 ${money(Math.round(fixedDelta))}만원 늘어요. 손에 남는 돈 ${money(Math.round(keep))}만원을 그대로 지키려면 그만큼과 거기 딸린 재료비까지 메워야 해서, 매출이 ${money(Math.round(salesDelta))}만원 더 필요해요.`
            : `매장 유지비가 매달 ${money(Math.round(-fixedDelta))}만원 줄어요. 그래서 손에 남는 돈 ${money(Math.round(keep))}만원을 지키는 데 필요한 매출도 ${money(Math.round(-salesDelta))}만원 적어요.`}
      </p>
    </div>
  );
}

function SalesPanel({ data, candidate, rows, recommendedId, places }) {
  const current = Number(data?.current_monthly_sales);
  const required = Number(candidate?.min_required_sales);
  const predicted = Number(candidate?.ml?.predicted_monthly_sales);
  const lift = Number.isFinite(current) && current > 0 && Number.isFinite(required)
    ? (required / current - 1) * 100
    : null;
  const buffer = Number.isFinite(predicted) && Number.isFinite(required) && required > 0
    ? (predicted / required - 1) * 100
    : null;

  const targetMonths = candidate.target_months || data?.target_recovery_months;
  const targetPeriod = (candidate.target_periods || []).find((period) => period.months === targetMonths);

  return (
    <div className="cx-panel-stack">
      <section className="cx-section-card">
        <div className="cx-section-head">
          <div><h2>지금보다 얼마나 더 팔아야 하는지 봐요</h2></div>
          <span className="cx-help">후보 {candidate.site_id} 기준</span>
        </div>
        <RequirementBreakdown data={data} candidate={candidate} current={current} required={required} lift={lift} />
      </section>

      <section className="cx-section-card">
        <div className="cx-section-head">
          <div><h2 id="predict-title">이 상권 카페 한 곳이 평균 얼마나 파는지 추정했어요</h2></div>
          <span className="cx-help">상권 평균 · 모델 추정</span>
        </div>
        {Number.isFinite(buffer) && (
          <p className="cx-sales-verdict">
            후보 {candidate.site_id} 상권의 평균 예상매출은 최소 필요매출보다
            <b className={buffer >= 0 ? "is-good" : "is-short"}>
              {" "}{buffer >= 0 ? `${buffer.toFixed(1)}% 높아요` : `${Math.abs(buffer).toFixed(1)}% 모자라요`}
            </b>
          </p>
        )}
        <PredictedSales candidates={rows} recommendedId={recommendedId} places={places} />
        <p className="cx-data-source">출처: 서울 열린데이터 광장</p>
      </section>

      {targetPeriod && (
        <section className="cx-section-card">
          <div className="cx-section-head"><div><h2>기간을 늘릴수록 매달 필요한 매출은 줄어요</h2></div></div>
          <RecoveryCurve key={candidate.site_id} data={data} candidate={candidate} pickedMonths={targetMonths} />
        </section>
      )}
    </div>
  );
}

/**
 * 합계가 어떤 값들로 이뤄졌는지만 펼쳐 보여준다. 설명 문구는 두지 않는다.
 * 0원 항목은 빼서 목록이 길어지지 않게 한다.
 */
function CostItems({ items, label }) {
  const [open, setOpen] = useState(false);
  const listed = (items || []).filter((item) => Number(item.amount) > 0);
  if (!listed.length) return null;

  const total = listed.reduce((sum, item) => sum + Number(item.amount), 0);

  return (
    <span className="cx-items">
      <button
        type="button"
        className="cx-items-toggle"
        aria-expanded={open}
        aria-label={`${label} 세부 항목 ${open ? "접기" : "펼치기"}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={15} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {open && (
        <span className="cx-items-pop" role="group" aria-label={`${label} 세부 항목`}>
          {listed.map((item) => (
            <span className="cx-items-row" key={item.label}>
              <b>{item.label}</b>
              <em>{money(item.amount)}만원</em>
            </span>
          ))}
          <span className="cx-items-row is-total">
            <b>합계</b>
            <em>{money(total)}만원</em>
          </span>
        </span>
      )}
    </span>
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
            <MiniStack
              total={100}
              height={12}
              label={`이전 소요자금의 ${Math.round(coverage)}%를 가용현금으로 채워요`}
              segments={[
                { key: "have", value: coverage, color: CHART.green },
                { key: "short", value: 100 - coverage, color: CHART.step1 },
              ]}
            />
            <div><span>추가 필요</span><strong className={candidate.additional_fund_needed > 0 ? "cx-risk-text" : ""}>{money(candidate.additional_fund_needed)}만원</strong></div>
          </div>
        </div>
        <dl className="cx-breakdown">
          <div>
            <dt>새로 묶이는 보증금</dt>
            <dd>{candidate.net_deposit_change < 0 ? `+${money(Math.abs(candidate.net_deposit_change))}` : money(candidate.net_deposit_change)}만원</dd>
            {candidate.net_deposit_change < 0 && <p className="cx-breakdown-note">후보 매장의 보증금이 더 저렴해요</p>}
          </div>
          <div>
            <dt>실제로 쓰는 이전비<CostItems items={candidate.relocation_cost_items} label="실제로 쓰는 이전비" /></dt>
            <dd>{money(candidate.actual_relocation_cost)}만원</dd>
          </div>
          <div>
            <dt>매달 운영비 변화<CostItems items={candidate.operating_cost_items} label="후보 매장 월 운영비" /></dt>
            <dd>{candidate.monthly_cost_delta > 0 ? `${money(candidate.monthly_cost_delta)}만원 더 들어요` : `${money(Math.abs(candidate.monthly_cost_delta))}만원 줄어요`}</dd>
          </div>
        </dl>
      </section>

      <PolicySection candidate={candidate} />
    </div>
  );
}

/** 상권변화지표를 안정 → 불안정 순으로 세운 축.
 *  HH(정체)  기존 점포가 오래 버티고 교체가 적다 — 가장 예측 가능
 *  LH(확장)  새로 들어오는 점포가 많아 평균 운영기간이 짧다
 *  HL(축소)  들어온 점포가 빨리 접는다
 *  LL(변동 큼) 진입도 퇴출도 가장 빠르다 — 변동이 가장 크다
 *  순서를 바꾸려면 이 배열만 고치면 축과 점 위치가 함께 따라온다. */
const CHANGE_SCALE = ["HH", "LH", "HL", "LL"];

/** 축 위치만으로는 왜 그 자리인지 알 수 없어, 분류별로 한 문장씩 붙인다. */
const CHANGE_MEANING = {
  HH: "점포가 오래 유지되고 교체가 적어요.",
  LH: "새로 들어오는 점포가 늘고 있어요.",
  HL: "들어온 점포가 오래 버티지 못해요.",
  LL: "새로 열고 닫는 속도가 가장 빨라요.",
};

/** 원본 분류명 '다이나믹'은 활발한 상권처럼 오해될 수 있어, 화면에서는 뜻을 바로 쓴다. */
const changeLabel = (code, name) => String(code ?? "").trim().toUpperCase() === "LL" ? "변동 큼" : name;

/** 지표 코드가 축의 몇 번째 눈금인지. 아는 코드가 아니면 null(표시 안 함). */
function changePosition(code) {
  const index = CHANGE_SCALE.indexOf(String(code ?? "").trim().toUpperCase());
  return index === -1 ? null : index;
}

// 같은 예상매출이라도 근거가 다르다. 상권 스냅샷이 있는 값과 자치구 평균으로
// 대체한 값을 나란히 놓고 같은 무게로 읽게 두면 안 된다 (B-15).
const PREDICTION_BASIS = {
  trdar_exact: { label: "이 상권 실측 기반", tone: "" },
  district_fallback: { label: "자치구 평균으로 대체", tone: " is-weak" },
  synthetic_fallback: { label: "실제 상권 데이터 아님", tone: " is-risk" },
};

/** 예상매출 툴팁. 후보 하나에 대해 두 값을 같이 읽게 한다. */
function PredictedSalesTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="cx-rechart-tooltip">
      <span>{label} 상권 평균</span>
      <strong>{money(row.predicted)}만원</strong>
      <small>이 상권 카페 한 곳 기준</small>
      {row.required != null && <small>최소 필요매출 {money(row.required)}만원</small>}
    </div>
  );
}

/**
 * 목록은 값을 정확히 읽는 자리고, 이 막대는 후보끼리의 크기 차이와
 * 최소 필요매출을 넘겼는지를 한눈에 보는 자리다.
 */
function PredictedSalesChart({ candidates = [], recommendedId }) {
  const data = candidates
    .filter((row) => hasValue(row.ml?.predicted_monthly_sales))
    .map((row) => ({
      label: `후보 ${row.site_id}`,
      predicted: Number(row.ml.predicted_monthly_sales),
      required: hasValue(row.min_required_sales) ? Number(row.min_required_sales) : null,
      recommended: row.site_id === recommendedId,
    }));
  if (!data.length) return null;

  return (
    <div className="cx-rechart cx-predict-rechart" role="img" aria-label="후보별 상권 평균 예상매출과 최소 필요매출 비교">
      <ResponsiveContainer width="100%" height={data.length * 74 + 46}>
        <BarChart data={data} layout="vertical" margin={{ top: 16, right: 86, bottom: 6, left: 4 }} barGap={5}>
          <CartesianGrid horizontal={false} stroke={CHART.grid} strokeDasharray="4 4" />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fill: CHART.weak, fontSize: 12, fontWeight: 700 }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip content={<PredictedSalesTooltip isAnimationActive={false} />} cursor={{ fill: "rgba(18,22,25,.035)" }} />
          <Bar dataKey="required" name="최소 필요매출" fill={CHART.baselineBar} barSize={11} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            <LabelList dataKey="required" position="right" offset={7} fill={CHART.weak} fontSize={12} fontWeight={700} formatter={(v) => (v == null ? "" : `${money(v)}`)} />
          </Bar>
          <Bar dataKey="predicted" name="상권 평균 예상매출" barSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((row) => (
              <Cell
                key={row.label}
                fill={row.required != null && row.predicted < row.required
                  ? CHART.risk
                  : row.recommended ? CHART.brand : CHART.brandSoft}
              />
            ))}
            <LabelList dataKey="predicted" position="right" offset={7} fill="#121619" fontSize={12} fontWeight={750} formatter={(v) => `${money(v)}만원`} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="cx-predict-legend">
        <span><i className="is-recommended" />추천 후보 상권 평균</span>
        <span><i className="is-predicted" />그 밖의 후보 상권 평균</span>
        <span><i className="is-required" />최소 필요매출</span>
      </p>
    </div>
  );
}

/**
 * 위의 관측 신호들로 모델이 추정한 예상매출.
 * 값 자체는 판단 요약 탭에도 있지만, 그 값이 어디서 왔고 얼마나 믿을 만한지는
 * 여기서만 말한다. 관측값 그룹과 섞지 않고 따로 세워 두는 이유다.
 */
function PredictedSales({ candidates = [], recommendedId, places }) {
  const usable = candidates.filter((row) => hasValue(row.ml?.predicted_monthly_sales));
  if (!usable.length) return null;

  const basisQuarter = hasValue(usable[0].ml?.basis_quarter) ? quarterMonths(usable[0].ml.basis_quarter) : null;
  const targetQuarter = hasValue(usable[0].ml?.target_quarter) ? quarterMonths(usable[0].ml.target_quarter) : null;
  const anyFallback = usable.some((row) => row.ml?.data_completeness !== "trdar_exact");

  return (
    <div className="cx-predict" role="group" aria-labelledby="predict-title">
      <div className="cx-predict-split">
        <div className="cx-predict-rows">
          {candidates.map((row) => {
            const ml = row.ml || {};
            const value = hasValue(ml.predicted_monthly_sales) ? Number(ml.predicted_monthly_sales) : null;
            const basis = PREDICTION_BASIS[ml.data_completeness] || { label: "근거 확인 불가", tone: " is-weak" };
            const areaName = places?.[row.site_id]?.trdar_nm;

            return (
              <article className="cx-predict-row" key={row.site_id}>
                <div className={`cx-predict-site${row.site_id === recommendedId ? " is-recommended" : ""}`}>
                  <strong>{areaName || row.name}</strong>
                  <span>후보 {row.site_id}{row.site_id === recommendedId ? " 추천 후보" : ""}</span>
                </div>
                <div className="cx-predict-value">
                  <span className="cx-predict-unit">상권 평균 한 곳</span>
                  <strong>{value == null ? "확인 불가" : `${money(value)}만원`}</strong>
                  {value != null && <span className={`cx-predict-basis${basis.tone}`}>{basis.label}</span>}
                </div>
                {ml.prediction_outlier && (
                  <p className="cx-predict-outlier">
                    <CircleAlert size={15} aria-hidden="true" />
                    실측 분포에서 매우 극단적인 값이에요. 보정하지 않고 원값 그대로 보여드려요.
                  </p>
                )}
              </article>
            );
          })}
        </div>
        <PredictedSalesChart candidates={candidates} recommendedId={recommendedId} />
      </div>
      <p className="cx-predict-note">
        {basisQuarter && targetQuarter
          ? `${basisQuarter}까지 공개된 실적으로 ${targetQuarter} 매출을 추정한 값이에요. `
          : ""}
        이 상권 커피·음료 총매출을 점포 수로 나눈 <b>평균 한 곳</b> 기준이에요.
        지금 매장이 상권 평균보다 잘 팔고 있다면 후보지에서도 이 값보다 높을 수 있고, 그 반대도 마찬가지예요.
        관측된 매출이 아니라 모델이 추정한 값이라 실제 매출을 보장하지 않아요.
        {anyFallback && " 자치구 평균으로 대체한 후보는 그 상권만의 매출 기록이 없어서, 실측 기반 후보와 같은 무게로 비교하면 안 돼요."}
      </p>
    </div>
  );
}

function MarketComparison({ candidates = [], recommendedId, places }) {
  const storeValues = candidates
    .map((row) => hasValue(row.market_observed?.store_count) ? Number(row.market_observed.store_count) : NaN)
    .filter(Number.isFinite);
  const storeMax = Math.max(...storeValues, 1);

  return (
    <div className="cx-market-compare" role="group" aria-labelledby="market-compare-title">
      <div className="cx-market-compare-head" aria-hidden="true">
        <span>후보 지역</span>
        <span>같은 업종 점포</span>
        <span>프랜차이즈 비율</span>
        <span>상권 안정도</span>
      </div>
      <div className="cx-market-compare-rows">
        {candidates.map((row) => {
          const observed = row.market_observed || {};
          const changeLabelText = changeLabel(observed.change_index, observed.change_name);
          const stores = hasValue(observed.store_count) ? Number(observed.store_count) : NaN;
          const storeWidth = Number.isFinite(stores) ? Math.max(3, stores / storeMax * 100) : 0;
          const franchiseShare = hasValue(observed.franchise_share) ? Number(observed.franchise_share) : NaN;
          const share = Number.isFinite(franchiseShare) ? Math.max(0, Math.min(100, franchiseShare)) : null;
          const stability = changePosition(observed.change_index);
          const isRecommended = row.site_id === recommendedId;
          const areaName = places?.[row.site_id]?.trdar_nm;
          // 원본은 YYYYQ 코드(예: 20244)라 그대로 쓰면 사용자가 읽을 수 없다
          const storePeriod = hasValue(observed.snapshot_period?.stores)
            ? quarterMonths(observed.snapshot_period.stores) : null;
          const changePeriod = hasValue(observed.snapshot_period?.change)
            ? quarterMonths(observed.snapshot_period.change) : null;

          return (
            <article className={`cx-market-compare-row${isRecommended ? " is-recommended" : ""}`} key={row.site_id}>
              <div className={`cx-market-site${isRecommended ? " is-recommended" : ""}`}>
                <strong>{row.name}</strong>
                <span>후보 {row.site_id}{isRecommended ? " 추천 후보" : ""}</span>
              </div>

              <div
                className="cx-market-metric"
                tabIndex="0"
                aria-label={`${row.name} 같은 업종 점포 ${Number.isFinite(stores) ? `${money(stores)}곳` : "확인 불가"}`}
              >
                <span className="cx-market-mobile-label">같은 업종 점포</span>
                <strong>{Number.isFinite(stores) ? `${money(stores)}곳` : "확인 불가"}</strong>
                <MiniBar
                  value={Number.isFinite(stores) ? stores : 0}
                  max={storeMax}
                  color={candidateColor(isRecommended)}
                  height={10}
                  label={`${row.name} 같은 업종 점포 막대`}
                />
                <span className="cx-metric-tooltip" role="tooltip">
                  {areaName || row.name}에서 관측한 값이에요.
                  {storePeriod ? ` 점포 기준은 ${storePeriod}예요.` : ""}
                </span>
              </div>

              <div
                className="cx-market-metric"
                tabIndex="0"
                aria-label={`${row.name} 프랜차이즈 비율 ${share === null ? "확인 불가" : `${share.toFixed(1)}%`}`}
              >
                <span className="cx-market-mobile-label">프랜차이즈 비율</span>
                <strong>{share === null ? "확인 불가" : `${share.toFixed(1)}%`}</strong>
                <MiniBar
                  value={share ?? 0}
                  max={100}
                  color={candidateColor(isRecommended)}
                  height={10}
                  label={`${row.name} 프랜차이즈 비율 막대`}
                />
                <span className="cx-metric-tooltip" role="tooltip">
                  {hasValue(observed.franchise_count) && Number.isFinite(stores)
                    ? `전체 ${money(stores)}곳 중 프랜차이즈는 ${money(observed.franchise_count)}곳이에요.`
                    : "프랜차이즈 점포 수를 확인할 수 없어요."}
                </span>
              </div>

              <div
                className={`cx-market-metric cx-risk-metric${stability === null ? " is-unavailable" : ""}`}
                tabIndex="0"
                aria-label={`${row.name} 상권 안정도 ${stability === null ? "확인 불가" : `${changeLabelText}, 네 단계 중 ${stability + 1}번째로 안정적`}`}
              >
                <span className="cx-market-mobile-label">상권 안정도</span>
                <strong>{stability === null ? "확인 불가" : changeLabelText}</strong>
                <StabilityScale
                  position={stability}
                  color={isRecommended ? CHART.brand : CHART.ink}
                  label={`${row.name} 상권 안정도 위치`}
                />
                <div className="cx-risk-axis" aria-hidden="true"><span>안정</span><span>불안정</span></div>
                <span className="cx-metric-tooltip" role="tooltip">
                  {stability === null
                    ? "서울시 상권변화지표가 연결되면 위치를 보여드려요."
                    : `${CHANGE_MEANING[CHANGE_SCALE[stability]]}${changePeriod ? ` 변화 기준은 ${changePeriod}예요.` : ""}`}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function FootfallTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="cx-rechart-tooltip">
      <span>{quarterMonths(point.quarter)}</span>
      <strong>{point.qoq == null ? "비교 기준" : `이전 3개월보다 ${signed(point.qoq)}`}</strong>
      <small>하루 평균 {headcount(point.daily)}명</small>
      <small>기준 기간 지수 {point.indexValue.toFixed(1)}</small>
    </div>
  );
}

function FootfallQuarterTick({ x, y, payload }) {
  const text = String(payload?.value);
  const year = text.slice(2, 4);
  const quarter = Number(text.slice(-1));
  const start = (quarter - 1) * 3 + 1;
  return (
    <g transform={`translate(${x} ${y})`}>
      <text textAnchor="middle" fill={CHART.weak} fontSize="12" fontWeight="650">
        <tspan x="0" dy="15">{year}년</tspan>
        <tspan x="0" dy="13">{start}~{start + 2}월</tspan>
      </text>
    </g>
  );
}

function FootfallBarLabel({ x, y, width, height, value }) {
  const numeric = Number(value) || 0;
  const barTop = Math.min(y, y + height);
  const barBottom = Math.max(y, y + height);
  const labelY = numeric < 0 ? barBottom + 15 : barTop - 7;
  const fill = numeric > 0 ? CHART.green : numeric < 0 ? CHART.risk : CHART.label;
  return <text x={x + width / 2} y={labelY} textAnchor="middle" fill={fill} fontSize="12" fontWeight="750">{Math.abs(numeric) < .005 ? "기준" : signed(numeric)}</text>;
}

function FootfallTrendChart({ candidates = [], recommendedId }) {
  const byDistrict = new Map();
  candidates.forEach((candidate) => {
    const district = candidate.candidate_region || "후보 지역";
    const points = (candidate.market_observed?.flow_pop_history || [])
      .filter((item) => Number.isFinite(Number(item.daily)))
      .sort((a, b) => String(a.quarter).localeCompare(String(b.quarter)))
      .slice(-6);
    if (!byDistrict.has(district) && points.length >= 2) {
      byDistrict.set(district, {
        district,
        points,
        recommended: candidate.site_id === recommendedId,
      });
    } else if (byDistrict.has(district) && candidate.site_id === recommendedId) {
      byDistrict.get(district).recommended = true;
    }
  });
  const series = [...byDistrict.values()].map((item) => {
    const base = Number(item.points[0]?.daily);
    const points = item.points.map((point, index) => {
      const daily = Number(point.daily);
      const previous = index ? Number(item.points[index - 1].daily) : null;
      return {
        ...point,
        daily,
        indexValue: base ? daily / base * 100 : 100,
        qoq: previous ? (daily / previous - 1) * 100 : null,
      };
    });
    return { ...item, points };
  });

  if (!series.length) {
    return <div className="cx-empty"><strong>유동인구 흐름을 그릴 데이터가 부족해요.</strong><p>3개월 단위 관측값이 두 번 이상 쌓이면 그래프로 보여드려요.</p></div>;
  }

  const maxQuarterChange = Math.max(
    .25,
    ...series.flatMap((item) => item.points.map((point) => Math.abs(point.qoq || 0))),
  );
  const scaleCeiling = Math.ceil(maxQuarterChange * 4) / 4;

  return (
    <div className="cx-footfall-chart">
      <div className="cx-trend-chart-head">
        <span>자치구 전체의 유동인구 흐름</span>
      </div>
      <div className="cx-index-scale" aria-hidden="true">
        <span>막대 범위 <strong>-{scaleCeiling.toFixed(2)}%~+{scaleCeiling.toFixed(2)}%</strong></span>
        <span>{quarterMonths(series[0].points[0].quarter)} 기준 <strong>100</strong></span>
      </div>
      <div className="cx-index-list">
        {series.map((item) => {
          const latest = item.points[item.points.length - 1];
          const fromBase = latest.indexValue - 100;
          return (
            <article className={`cx-index-card${item.recommended ? " is-recommended" : ""}`} key={item.district}>
              <header>
                <div>
                  <strong>{item.district}</strong>
                  {item.recommended && <span>추천 후보 지역</span>}
                </div>
                <dl>
                  <div><dt>현재</dt><dd>{headcount(latest.daily)}명</dd></div>
                  <div>
                    <dt>이전 3개월</dt>
                    <dd className={latest.qoq > 0 ? "is-positive" : latest.qoq < 0 ? "is-negative" : undefined}>
                      {latest.qoq === null ? "기준" : signed(latest.qoq)}
                    </dd>
                  </div>
                  <div>
                    <dt>기준 기간</dt>
                    <dd className={fromBase > 0 ? "is-positive" : fromBase < 0 ? "is-negative" : undefined}>{signed(fromBase)}</dd>
                  </div>
                </dl>
              </header>
              <div className="cx-rechart cx-footfall-rechart" role="img" aria-label={`${item.district} 분기별 유동인구의 이전 3개월 대비 변화율`}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={item.points.map((point, index) => ({ ...point, qoq: index === 0 ? 0 : point.qoq }))} margin={{ top: 28, right: 12, bottom: 14, left: 0 }}>
                    <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="4 4" />
                    <XAxis dataKey="quarter" tick={<FootfallQuarterTick />} axisLine={false} tickLine={false} interval={0} height={46} />
                    <YAxis domain={[-scaleCeiling, scaleCeiling]} ticks={[-scaleCeiling, 0, scaleCeiling]} tickFormatter={(tick) => `${tick > 0 ? "+" : ""}${tick.toFixed(2)}%`} tick={{ fill: CHART.weak, fontSize: 10 }} axisLine={false} tickLine={false} width={58} />
                    <Tooltip content={<FootfallTooltip isAnimationActive={false} />} cursor={{ fill: "rgba(18,22,25,.035)" }} />
                    <ReferenceLine y={0} stroke={CHART.label} strokeWidth={2.2} />
                    <Bar dataKey="qoq" name="이전 3개월 대비" maxBarSize={34} radius={[5, 5, 5, 5]} isAnimationActive={false}>
                      {item.points.map((point, index) => {
                        const change = index === 0 ? 0 : point.qoq;
                        const up = item.recommended ? CHART.brand : CHART.brandSoft;
                        return <Cell key={point.quarter} fill={change > 0 ? up : change < 0 ? CHART.risk : CHART.neutral} />;
                      })}
                      <LabelList dataKey="qoq" content={<FootfallBarLabel />} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          );
        })}
      </div>
      <p className="cx-data-source">출처: 서울 열린데이터 광장 유동인구, 자치구 단위 합산</p>
    </div>
  );
}

/** 아이콘 규격은 결과지 전체와 맞춘다. */
const POLICY_ICON = { size: 15, strokeWidth: 2.2, "aria-hidden": true };

/**
 * 공고 문자열은 "1억원 이내(일반 5천만원/특화 7천만원)"처럼 핵심값과 단서가 붙어 온다.
 * 괄호를 기준으로 갈라 핵심값만 크게 읽히게 한다. 괄호가 없으면 그대로 둔다.
 */
function splitDetail(value) {
  if (!value) return { main: "확인 필요", detail: null };
  const at = value.indexOf("(");
  if (at < 1) return { main: value.trim(), detail: null };
  return { main: value.slice(0, at).trim(), detail: value.slice(at + 1).replace(/\)\s*$/, "").trim() };
}

/**
 * 정책명은 "2026년 서울시 중소기업육성자금 - 창업기업자금"처럼 사업군과 세부자금이 붙어 온다.
 * 세 카드에서 반복되는 앞부분을 아래로 내리고 실제로 갈리는 뒷부분을 제목으로 올린다.
 */
function splitPolicyName(name) {
  if (!name) return { group: null, title: "이름 확인 필요" };
  const at = name.lastIndexOf(" - ");
  if (at < 1) return { group: null, title: name };
  return { group: name.slice(0, at).trim(), title: name.slice(at + 3).trim() };
}

const fundUseLabel = (value) => {
  if (!value) return "확인 필요";
  if (value.includes("working_capital")) return "경영안정 및 운전자금";
  if (value.includes("facility")) return "시설자금";
  return value;
};

/**
 * 판단에 쓰는 값(지원한도, 금리)을 카드에서 가장 큰 글자로 두고,
 * 기관과 업력처럼 확인용 정보는 접어 둔다. 첫 화면에서 읽을 줄을 줄이는 게 목적이다.
 */
function PolicyCard({ policy, district, showStatus }) {
  const [open, setOpen] = useState(false);
  const { group, title } = splitPolicyName(policy.name);
  const limit = splitDetail(policy.amount_limit);
  const rate = splitDetail(policy.interest_rate);
  const region = [policy.region_scope, policy.region_slot].find(Boolean) || district;

  return (
    <article className="cx-policy-card">
      <header>
        <div className="cx-policy-type">
          <span><HandCoins {...POLICY_ICON} />{policy.support_type || "정책금융"}</span>
          {showStatus && (
            <b className={policy.application_status === "접수 중" ? "is-open" : ""}>
              <CalendarClock {...POLICY_ICON} />{policy.application_status || "신청기간 확인 필요"}
            </b>
          )}
        </div>
        <h3>{title}</h3>
        {group && <p className="cx-policy-group">{group}</p>}
      </header>

      <div className="cx-policy-figures">
        <div>
          <dt><Coins {...POLICY_ICON} />지원한도</dt>
          <dd>{limit.main}</dd>
          {limit.detail && <small>{limit.detail}</small>}
        </div>
        <div>
          <dt><Percent {...POLICY_ICON} />금리</dt>
          <dd>{rate.main}</dd>
          {rate.detail && <small>{rate.detail}</small>}
        </div>
      </div>

      <p className="cx-policy-target">
        {policy.target || "지원 대상과 세부 자격은 공식 공고에서 확인해 주세요."}
      </p>

      <button type="button" className="cx-policy-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronDown {...POLICY_ICON} className={open ? "is-open" : ""} />
        {open ? "접기" : "기관과 조건 더 보기"}
      </button>
      {open && (
        <dl className="cx-policy-detail">
          <div><dt><Building2 {...POLICY_ICON} />수행기관</dt><dd>{policy.agency || "확인 필요"}</dd></div>
          <div><dt><Wallet {...POLICY_ICON} />자금용도</dt><dd>{fundUseLabel(policy.fund_use)}</dd></div>
          <div><dt><CalendarDays {...POLICY_ICON} />업력</dt><dd>{policy.business_age_requirement || "확인 필요"}</dd></div>
          <div><dt><MapPin {...POLICY_ICON} />지역</dt><dd>{region}</dd></div>
        </dl>
      )}

      <footer>
        <span className={policy.eligibility_needs_check ? "is-check" : "is-ready"}>
          {policy.eligibility_needs_check ? <CircleAlert {...POLICY_ICON} /> : <BadgeCheck {...POLICY_ICON} />}
          {policy.eligibility_note || "자격 추가 확인 필요"}
        </span>
        {policy.url ? (
          <a href={policy.url} target="_blank" rel="noreferrer" aria-label={`${policy.name} 공식 공고 열기`}>
            공식 공고 <ArrowUpRight {...POLICY_ICON} />
          </a>
        ) : <span className="cx-policy-no-link">공고 링크 확인 필요</span>}
      </footer>
    </article>
  );
}

/** 선택한 후보의 자치구 기준 정책금융. 판단 요약에서 바로 다음 행동으로 이어지는 자리다. */
function PolicySection({ candidate }) {
  const policies = candidate.policy_rag?.results || [];
  const district = candidate.candidate_region || "후보 지역";
  const policyPriority = candidate.policy_rag?.fund_priority;

  // 접수 상태가 전부 같으면 카드마다 되풀이하지 않고 섹션 머리에 한 번만 쓴다.
  const statuses = [...new Set(policies.map((policy) => policy.application_status || "신청기간 확인 필요"))];
  const sharedStatus = policies.length > 1 && statuses.length === 1 ? statuses[0] : null;

  return (
    <section className="cx-section-card cx-policy-section">
      <div className="cx-policy-heading">
        <div>
          <span className="cx-policy-kicker">선택한 후보 기준</span>
          <h2>{district}에서 확인할 정책금융</h2>
        </div>
        <p>
          추가 필요 이전자금 {money(candidate.additional_fund_needed)}만원과 {district} 기준
          <strong> 최대 3건</strong>
        </p>
      </div>

      <div className="cx-policy-priority-row">
        <p className={`cx-policy-priority ${policyPriority === "low" ? "is-low" : ""}`}>
          <Landmark {...POLICY_ICON} />
          {policyPriority === "low"
            ? "자기자금으로 이전비를 충당할 수 있어 자금 보존 관점에서 확인해 보세요."
            : "추가 자금 필요성이 커 정책금융 활용 우선도가 높아요."}
        </p>
        {sharedStatus && (
          <span className="cx-policy-status">
            <CalendarClock {...POLICY_ICON} />{policies.length}건 모두 {sharedStatus}
          </span>
        )}
      </div>

      {policies.length ? (
        <div className="cx-policy-list">
          {policies.map((policy, index) => (
            <PolicyCard
              key={`${policy.name}-${index}`}
              policy={policy}
              district={district}
              showStatus={!sharedStatus}
            />
          ))}
        </div>
      ) : (
        <div className="cx-empty">
          <strong>{district}에서 바로 연결할 정책금융을 찾지 못했어요.</strong>
          <p>사업장 소재지와 접수 시점에 따라 달라질 수 있어요.</p>
        </div>
      )}
      <div className="cx-policy-disclaimer">
        <p><Scale {...POLICY_ICON} />정책지원 후보가 검색되어도 지원금을 확보한 것으로 계산하지 않아요. 실제 지원 여부는 해당 기관 심사로 정해져요.</p>
        <p>지원한도와 금리는 공고상 조건이며 실제 승인액과 다를 수 있어요.</p>
      </div>
      <p className="cx-data-source">출처: 기업마당과 각 기관 공식 공고</p>
    </section>
  );
}

function MarketPanel({ candidate, rows, recommendedId, places }) {

  return (
    <div className="cx-panel-stack">
      <section className="cx-section-card">
        <div className="cx-section-head"><div><h2>후보 지역의 최근 신호를 함께 봐요</h2></div><span className="cx-help">관측 데이터</span></div>
        <MarketTrendChart candidates={rows} recommendedId={recommendedId} />
        <div className="cx-market-group">
          <h3 id="market-compare-title">후보 지역의 상권 상태를 나란히 봐요</h3>
          <MarketComparison candidates={rows} recommendedId={recommendedId} places={places} />
          <p className="cx-data-source">출처: 서울 열린데이터 광장 점포와 상권변화지표</p>
        </div>

        <div className="cx-market-group is-context">
          <FootfallTrendChart candidates={rows} recommendedId={recommendedId} />
        </div>
      </section>

    </div>
  );
}

const TREND_DASH = { A: undefined, B: "10 6", C: "3 6" };
const TREND_NEUTRAL = CHART.neutral;
const TREND_RECOMMENDED = CHART.brand;

function MarketTrendTooltip({ active, payload, label, series, recommendedId }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const values = series.map((item) => {
    const key = row?.isForecast ? `forecast_${item.id}` : `observed_${item.id}`;
    const value = row?.[key];
    return Number.isFinite(value) ? { ...item, value } : null;
  }).filter(Boolean);

  if (!values.length) return null;
  return (
    <div className="cx-rechart-tooltip">
      <span>{quarterMonths(label)}{row?.isForecast ? " 추정" : ""}</span>
      {values.map((item) => (
        <div className="cx-rechart-tooltip-row" key={item.id}>
          <i style={{ background: item.id === recommendedId ? TREND_RECOMMENDED : TREND_NEUTRAL }} />
          <b>{item.name} 후보 {item.id}</b>
          <strong>{scaledWon(item.value)}원</strong>
        </div>
      ))}
    </div>
  );
}

function MarketTrendChart({ candidates = [], recommendedId }) {
  const series = candidates
    .map((candidate) => {
      const points = (candidate.market_observed?.sales_history || [])
        .filter((item) => Number.isFinite(Number(item.monthly_sales)))
        .sort((a, b) => String(a.quarter).localeCompare(String(b.quarter)));
      const forecastValue = Number(candidate.ml?.predicted_district_sales);
      const forecastQuarter = candidate.ml?.target_quarter;
      const forecast = Number.isFinite(forecastValue) && hasValue(forecastQuarter) && points.length
        ? { quarter: String(forecastQuarter), monthly_sales: forecastValue }
        : null;
      return {
        id: candidate.site_id,
        name: candidate.candidate_region || candidate.name,
        points,
        forecast,
      };
    })
    .filter((item) => item.points.length >= 2);

  const observedQuarters = [...new Set(series.flatMap((item) => item.points.map((point) => String(point.quarter))))].sort();
  const forecastQuarters = [...new Set(series.map((item) => item.forecast?.quarter).filter(Boolean))]
    .filter((quarter) => !observedQuarters.includes(quarter))
    .sort();
  const quarters = [...observedQuarters, ...forecastQuarters];

  if (!series.length || quarters.length < 2) {
    return <div className="cx-empty"><strong>3개월 단위 흐름을 그릴 데이터가 부족해요.</strong><p>관측값이 두 번 이상 쌓이면 그래프로 보여드려요.</p></div>;
  }

  const values = series.flatMap((item) => [
    ...item.points.map((point) => Number(point.monthly_sales)),
    ...(item.forecast ? [item.forecast.monthly_sales] : []),
  ]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawRange = rawMax - rawMin || Math.max(rawMax * .1, 1);
  const axisMin = Math.max(0, rawMin - rawRange * .1);
  const axisMax = rawMax + rawRange * .1;
  const renderSeries = [
    ...series.filter((item) => item.id !== recommendedId),
    ...series.filter((item) => item.id === recommendedId),
  ];
  const chartData = quarters.map((quarter) => {
    const row = { quarter, isForecast: forecastQuarters.includes(quarter) };
    series.forEach((item) => {
      const observed = item.points.find((point) => String(point.quarter) === quarter);
      if (observed) row[`observed_${item.id}`] = Number(observed.monthly_sales);
      if (item.forecast) {
        const last = item.points[item.points.length - 1];
        if (String(last.quarter) === quarter) row[`forecast_${item.id}`] = Number(last.monthly_sales);
        if (item.forecast.quarter === quarter) row[`forecast_${item.id}`] = Number(item.forecast.monthly_sales);
      }
    });
    return row;
  });
  const basisSource = candidates.find((row) => hasValue(row.ml?.basis_quarter))?.ml;
  const recencyNote = basisSource ? dataRecencyNote(basisSource.basis_quarter, basisSource.target_quarter) : null;
  const lastObservedQuarter = observedQuarters[observedQuarters.length - 1];

  return (
    <div className="cx-trend-chart">
      <div className="cx-trend-chart-head">
        <span>후보 지역별 동종업종 매출 흐름</span>
        {recencyNote && <small>{recencyNote}</small>}
      </div>
      <div className="cx-trend-legend" aria-label="후보별 그래프 선 안내">
        {series.map((item) => (
          <span key={item.id}>
            <i
              className="cx-trend-swatch"
              style={{
                "--swatch-color": item.id === recommendedId ? TREND_RECOMMENDED : TREND_NEUTRAL,
                "--swatch-style": item.id === "A" ? "solid" : "dashed",
              }}
            />
            <strong>{item.name} 후보 {item.id}</strong>
          </span>
        ))}
        {forecastQuarters.length > 0 && <span><i className="cx-trend-swatch is-forecast" /><strong>집계 전 추정</strong></span>}
      </div>
      <div className="cx-rechart cx-market-trend-rechart" role="img" aria-label="후보 지역별 분기 매출 실측과 집계 전 추정 흐름">
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={chartData} margin={{ top: 32, right: 18, bottom: 12, left: 4 }}>
            <CartesianGrid stroke={CHART.grid} strokeDasharray="4 4" vertical={false} />
            {forecastQuarters.length > 0 && (
              <ReferenceArea
                x1={lastObservedQuarter}
                x2={quarters[quarters.length - 1]}
                fill={CHART.neutral}
                fillOpacity={0.09}
                label={{ value: "집계 전 추정", position: "insideTopRight", fill: CHART.label, fontSize: 12, fontWeight: 700 }}
              />
            )}
            <XAxis dataKey="quarter" tickFormatter={(quarter) => quarterMonths(quarter, true)} tick={{ fill: CHART.label, fontSize: 12, fontWeight: 650 }} axisLine={{ stroke: CHART.axis }} tickLine={false} interval="preserveStartEnd" />
            <YAxis type="number" domain={[axisMin, axisMax]} tickFormatter={(value) => scaledWon(value)} tick={{ fill: CHART.label, fontSize: 11 }} axisLine={false} tickLine={false} width={70} />
            <Tooltip content={<MarketTrendTooltip series={series} recommendedId={recommendedId} isAnimationActive={false} />} cursor={{ stroke: CHART.label, strokeWidth: 1.2, strokeDasharray: "4 4" }} />
            {renderSeries.map((item) => {
              const color = item.id === recommendedId ? TREND_RECOMMENDED : TREND_NEUTRAL;
              return (
                <Line
                  key={`observed_${item.id}`}
                  type="monotone"
                  dataKey={`observed_${item.id}`}
                  name={`${item.name} 후보 ${item.id}`}
                  stroke={color}
                  strokeWidth={item.id === recommendedId ? 3.5 : 2.5}
                  strokeDasharray={TREND_DASH[item.id]}
                  dot={{ r: 3.5, fill: color, stroke: "#ffffff", strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: color, stroke: "#ffffff", strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              );
            })}
            {renderSeries.filter((item) => item.forecast).map((item) => {
              const color = item.id === recommendedId ? TREND_RECOMMENDED : TREND_NEUTRAL;
              return (
                <Line
                  key={`forecast_${item.id}`}
                  type="monotone"
                  dataKey={`forecast_${item.id}`}
                  name={`${item.name} 후보 ${item.id} 추정`}
                  stroke={color}
                  strokeWidth={item.id === recommendedId ? 3.5 : 2.5}
                  strokeDasharray="3 5"
                  strokeOpacity={0.68}
                  dot={{ r: 4, fill: "#ffffff", stroke: color, strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: "#ffffff", stroke: color, strokeWidth: 3 }}
                  connectNulls
                  isAnimationActive={false}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="cx-data-source">출처: 서울 열린데이터 광장 추정매출, 자치구 단위 집계</p>
    </div>
  );
}
