import { useEffect, useMemo, useState } from "react";
import ResultScreen from "./ResultScreen";
import { n, money } from "./insights";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";
const SITE_IDS = ["A", "B", "C"];

const emptyCurrent = () => ({
  address: "",
  monthly_sales: "",
  variable_cost: "",
  fixed_cost: "",
  deposit: "",
  available_self_fund: "",
});

const emptyCandidate = (id) => ({
  site_id: id,
  name: "",
  monthly_rent: "",
  maintenance_fee: "",
  other_fixed_cost: "",
  deposit: "",
  interior_cost: "",
  moving_cost: "",
  restoration_cost: "",
  rights_fee: "",
  other_moving_cost: "",
  closed_days: "",
  trdar_cd: null,
});

const SCENARIOS = {
  higher: {
    current: {
      address: "서울 마포구 연남동",
      monthly_sales: "2800",
      variable_cost: "980",
      fixed_cost: "1050",
      deposit: "3000",
      available_self_fund: "1500",
    },
    count: 3,
    candidates: [
      { site_id: "A", name: "서울 강남구 역삼동", monthly_rent: "1150", maintenance_fee: "120", other_fixed_cost: "100", deposit: "5000", interior_cost: "1800", moving_cost: "150", restoration_cost: "300", rights_fee: "500", other_moving_cost: "100", closed_days: "7", trdar_cd: null },
      { site_id: "B", name: "서울 성동구 성수동", monthly_rent: "1050", maintenance_fee: "100", other_fixed_cost: "80", deposit: "4500", interior_cost: "1600", moving_cost: "150", restoration_cost: "300", rights_fee: "400", other_moving_cost: "100", closed_days: "6", trdar_cd: null },
      { site_id: "C", name: "서울 마포구 망원동", monthly_rent: "980", maintenance_fee: "100", other_fixed_cost: "70", deposit: "4000", interior_cost: "1400", moving_cost: "120", restoration_cost: "250", rights_fee: "300", other_moving_cost: "80", closed_days: "5", trdar_cd: null },
    ],
  },
  lower: {
    current: {
      address: "서울 마포구 연남동",
      monthly_sales: "2800",
      variable_cost: "980",
      fixed_cost: "1200",
      deposit: "3000",
      available_self_fund: "1200",
    },
    count: 3,
    candidates: [
      { site_id: "A", name: "서울 마포구 망원동", monthly_rent: "700", maintenance_fee: "90", other_fixed_cost: "60", deposit: "3000", interior_cost: "1200", moving_cost: "120", restoration_cost: "250", rights_fee: "200", other_moving_cost: "80", closed_days: "5", trdar_cd: null },
      { site_id: "B", name: "서울 관악구 봉천동", monthly_rent: "620", maintenance_fee: "80", other_fixed_cost: "50", deposit: "2500", interior_cost: "1100", moving_cost: "100", restoration_cost: "250", rights_fee: "150", other_moving_cost: "70", closed_days: "5", trdar_cd: null },
      { site_id: "C", name: "서울 은평구 응암동", monthly_rent: "580", maintenance_fee: "70", other_fixed_cost: "50", deposit: "2000", interior_cost: "1000", moving_cost: "100", restoration_cost: "220", rights_fee: "100", other_moving_cost: "60", closed_days: "4", trdar_cd: null },
    ],
  },
};

const CURRENT_STEPS = [
  { key: "address", type: "text", kicker: "현재 매장 · 1", title: "지금 운영 중인 카페는 어디에 있나요?", help: "서울 주소를 입력해주세요." },
  { key: "monthly_sales", type: "money", kicker: "현재 매장 · 2", title: "한 달 평균 매출은 얼마 정도예요?", help: "최근 3개월 평균 기준으로 입력해주세요." },
  { key: "variable_cost", type: "money", kicker: "현재 매장 · 3", title: "한 달 변동비는 얼마 정도 나가요?", help: "재료비, 결제수수료처럼 매출에 따라 달라지는 비용이에요." },
  { key: "fixed_cost", type: "money", kicker: "현재 매장 · 4", title: "한 달 고정비는 얼마 정도예요?", help: "임대료, 고정 인건비, 관리비, 대출이자 등 정기비용을 포함해주세요." },
  { key: "deposit", type: "money", kicker: "현재 매장 · 5", title: "현재 매장 보증금은 얼마예요?", help: "후보지 보증금과 비교해 실제 추가 부담을 계산합니다." },
  { key: "available_self_fund", type: "money", kicker: "현재 매장 · 6", title: "이전에 바로 쓸 수 있는 자기자금은 얼마예요?", help: "생활비·비상자금은 제외해주세요. 현재 매장 보증금은 별도로 계산합니다." },
];

function monthlyCost(c) { return n(c.monthly_rent) + n(c.maintenance_fee) + n(c.other_fixed_cost); }

export default function App() {
  const [phase, setPhase] = useState("start");
  const [current, setCurrent] = useState(emptyCurrent());
  const [currentStep, setCurrentStep] = useState(0);
  const [candidateCount, setCandidateCount] = useState(1);
  const [candidates, setCandidates] = useState(SITE_IDS.map(emptyCandidate));
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [recoveryMonths, setRecoveryMonths] = useState(24);
  const [result, setResult] = useState(null);
  const [aiState, setAiState] = useState("idle");
  const [loadingStage, setLoadingStage] = useState("core");
  const [places, setPlaces] = useState({ current: null, A: null, B: null, C: null });
  const [error, setError] = useState("");
  const [demoScenario, setDemoScenario] = useState(null);

  const activeCandidates = useMemo(() => candidates.slice(0, candidateCount), [candidates, candidateCount]);
  const lowerOrEqual = useMemo(
    () => activeCandidates.filter((c) => monthlyCost(c) <= n(current.fixed_cost)),
    [activeCandidates, current.fixed_cost]
  );
  const hasCostRecovery = lowerOrEqual.length > 0;

  function start(mode = "blank") {
    if (mode === "blank") {
      setCurrent(emptyCurrent());
      setCandidateCount(1);
      setCandidates(SITE_IDS.map(emptyCandidate));
      setDemoScenario(null);
    } else {
      const s = SCENARIOS[mode];
      setCurrent({ ...s.current });
      setCandidateCount(s.count);
      setCandidates(SITE_IDS.map((id, i) => s.candidates[i] ? { ...s.candidates[i] } : emptyCandidate(id)));
      setDemoScenario(mode === "higher" ? 1 : 2);
    }
    setCurrentStep(0);
    setCandidateIndex(0);
    setRecoveryMonths(24);
    setResult(null);
    setError("");
    setPhase("current");
  }

  function goBack() {
    setError("");
    if (phase === "current") {
      if (currentStep === 0) return setPhase("start");
      return setCurrentStep((x) => Math.max(0, x - 1));
    }
    if (phase === "count") return setPhase("current"), setCurrentStep(CURRENT_STEPS.length - 1);
    if (phase === "candidate") {
      if (candidateIndex === 0) return setPhase("count");
      return setCandidateIndex((x) => Math.max(0, x - 1));
    }
    if (phase === "branchCheck") return setPhase("candidate"), setCandidateIndex(candidateCount - 1);
    if (phase === "recovery") return setPhase("branchCheck");
  }

  function nextCurrent() {
    const spec = CURRENT_STEPS[currentStep];
    const value = current[spec.key];
    if (spec.type === "text" && !String(value || "").trim()) return setError("주소를 입력해주세요.");
    if (spec.key === "monthly_sales" && n(value) <= 0) return setError("월매출은 0보다 크게 입력해주세요.");
    if (spec.type === "money" && (value === "" || n(value) < 0)) return setError("0 이상의 금액을 입력해주세요.");
    setError("");
    if (currentStep < CURRENT_STEPS.length - 1) setCurrentStep((x) => x + 1);
    else setPhase("count");
  }

  function chooseCount(count) {
    setCandidateCount(count);
    setCandidates((prev) => SITE_IDS.map((id, i) => prev[i] ? { ...prev[i], site_id: id } : emptyCandidate(id)));
    setCandidateIndex(0);
    setError("");
    setPhase("candidate");
  }

  function updateCandidate(index, key, value) {
    setCandidates((prev) => prev.map((c, i) => i === index ? { ...c, [key]: value } : c));
  }

  function nextCandidate() {
    const c = candidates[candidateIndex];
    if (!String(c.name || "").trim()) return setError("후보지 주소를 입력해주세요.");
    const numericKeys = ["monthly_rent", "maintenance_fee", "other_fixed_cost", "deposit", "interior_cost", "moving_cost", "restoration_cost", "rights_fee", "other_moving_cost", "closed_days"];
    if (numericKeys.some((k) => c[k] !== "" && n(c[k]) < 0)) return setError("비용과 휴업일수는 0 이상으로 입력해주세요.");
    setError("");
    if (candidateIndex + 1 < candidateCount) setCandidateIndex((x) => x + 1);
    else setPhase("branchCheck");
  }

  async function resolvePlace(key, address) {
    if (!address?.trim()) return null;
    try {
      const r = await fetch(`${API_BASE}/commercial-area`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: address.trim() }),
      });
      if (!r.ok) return null;
      const raw = await r.json();
      return { site_id: key, label: key === "current" ? "현재 매장" : `후보 ${key}`, lat: raw.lat, lng: raw.lng, trdar_cd: raw.trdar_cd, trdar_nm: raw.trdar_nm, boundary: raw.boundary };
    } catch { return null; }
  }

  async function analyze() {
    setPhase("loading");
    setError("");
    try {
      // 주소 변환은 서로 독립적이므로 동시에 요청한다. 한 주소 실패는 Rule/ML/RAG 전체를 막지 않는다.
      const resolved = await Promise.all([
        resolvePlace("current", current.address),
        ...activeCandidates.map((c) => resolvePlace(c.site_id, c.name)),
      ]);
      const nextPlaces = { current: resolved[0], A: null, B: null, C: null };
      activeCandidates.forEach((c, i) => { nextPlaces[c.site_id] = resolved[i + 1]; });
      setPlaces(nextPlaces);

      const payload = {
        business_name: "우리 매장",
        industry: "커피-음료",
        industry_code: "CS100010",
        current: {
          address: current.address,
          monthly_sales: n(current.monthly_sales),
          variable_cost: n(current.variable_cost),
          fixed_cost: n(current.fixed_cost),
          deposit: n(current.deposit),
          available_self_fund: n(current.available_self_fund),
        },
        target_recovery_months: hasCostRecovery ? Number(recoveryMonths) : null,
        candidates: activeCandidates.map((c, i) => ({
          site_id: c.site_id,
          name: c.name,
          trdar_cd: resolved[i + 1]?.trdar_cd || null,
          monthly_rent: n(c.monthly_rent),
          maintenance_fee: n(c.maintenance_fee),
          other_fixed_cost: n(c.other_fixed_cost),
          deposit: n(c.deposit),
          interior_cost: n(c.interior_cost),
          moving_cost: n(c.moving_cost),
          restoration_cost: n(c.restoration_cost),
          rights_fee: n(c.rights_fee),
          other_moving_cost: n(c.other_moving_cost),
          closed_days: n(c.closed_days),
        })),
      };

      // 1단계: Rule + ML + 후보별 RAG만 계산(수백 ms) — 서버는 이 결과를 analysis_id로
      // 잠시 캐시해둔다. 화면 전환은 아직 하지 않는다: AI 해석까지 끝난 완성된 결과
      // 화면을 한 번에 보여주고 싶다는 요구라, 로딩 화면에서 계속 대기한다.
      const r = await fetch(`${API_BASE}/staymove?explain=false&use_rag=true&use_ml=true`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      const core = await r.json();
      setLoadingStage("ai");

      // 2단계: AI 설명. 코어 계산값을 다시 클라이언트가 보내는 대신 서버가 analysis_id로
      // 캐시해둔 값을 그대로 써서 프롬프트 인젝션 여지를 막는다. 실패해도 결과 자체는
      // 이미 계산돼 있으므로 계산·검색 결과만으로 화면을 보여준다(전체 실패 아님).
      let finalResult = core;
      let nextAiState = "done";
      try {
        const er = await fetch(`${API_BASE}/staymove/explain`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysis_id: core.analysis_id }),
        });
        if (!er.ok) throw new Error(await er.text());
        const explain = await er.json();
        const bySite = Object.fromEntries(explain.candidates.map((c) => [c.site_id, c.ai_explanation]));
        finalResult = {
          ...core,
          candidates: core.candidates.map((c) => ({ ...c, ai_explanation: bySite[c.site_id] || c.ai_explanation })),
          comparison_summary: explain.comparison_summary,
          overall: explain.overall,
          performance: { ...core.performance, ...explain.performance },
        };
      } catch {
        nextAiState = "error";
      }

      setResult(finalResult);
      setAiState(nextAiState);
      setPhase("result");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(cleanError(e.message));
      setPhase("branchCheck");
    } finally {
      setLoadingStage("core");
    }
  }

  if (phase === "start") return <StartScreen onStart={start} />;
  if (phase === "current") return <CurrentQuestion current={current} setCurrent={setCurrent} index={currentStep} demoScenario={demoScenario} error={error} onBack={goBack} onNext={nextCurrent} />;
  if (phase === "count") return <CandidateCount candidateCount={candidateCount} demoScenario={demoScenario} onBack={goBack} onChoose={chooseCount} />;
  if (phase === "candidate") return <CandidateForm candidate={candidates[candidateIndex]} index={candidateIndex} count={candidateCount} demoScenario={demoScenario} error={error} onChange={(k, v) => updateCandidate(candidateIndex, k, v)} onBack={goBack} onNext={nextCandidate} />;
  if (phase === "branchCheck") return <BranchCheck current={current} candidates={activeCandidates} lowerCount={lowerOrEqual.length} error={error} onBack={goBack} onNext={() => hasCostRecovery ? setPhase("recovery") : analyze()} />;
  if (phase === "recovery") return <Recovery months={recoveryMonths} setMonths={setRecoveryMonths} onBack={goBack} onNext={analyze} />;
  if (phase === "loading") return <LoadingScreen stage={loadingStage} />;
  if (phase === "result") return <ResultScreen data={result} places={places} aiState={aiState} onRestart={() => setPhase("start")} />;
  return null;
}

function Header({ progress, label, onBack }) {
  return <header className="onboard-header"><button onClick={onBack}>←</button><div className="progress"><i style={{ width: `${progress}%` }} /></div><span>{label}</span></header>;
}
function Prefill({ demoScenario }) { return demoScenario ? <div className="prefill-banner">시나리오 {demoScenario} 예시값이 입력되어 있어요 · 수정 가능</div> : null; }

function StartScreen({ onStart }) {
  return <main className="start-page">
    <div className="brand">STAY OR MOVE</div>
    <section className="start-card">
      <span className="eyebrow">온보딩 데모</span>
      <h1>온보딩 데모 시나리오를<br/>골라서 확인해보세요.</h1>
      <p>시나리오를 누르면 결과로 바로 가지 않고, 예시값이 채워진 첫 번째 질문부터 시작합니다. 값은 중간에 직접 수정할 수 있어요.</p>
      <div className="demo-grid-web">
        <button className="demo-card-web" onClick={() => onStart("higher")}><b>시나리오 1</b><strong>현재보다 비용이 높은 후보를 검토</strong><small>A·B·C 예시값이 미리 채워집니다.</small></button>
        <button className="demo-card-web" onClick={() => onStart("lower")}><b>시나리오 2</b><strong>현재보다 비용이 낮은 후보를 검토</strong><small>마지막에 회수기간 추가 질문까지 확인합니다.</small></button>
      </div>
      <button className="primary" onClick={() => onStart("blank")}>빈 값으로 직접 시작</button>
      <small>실제 서비스에서는 자발/비자발을 묻지 않고, 입력 완료 후 후보별 월 운영비를 비교해 내부 분석모드를 정합니다.</small>
    </section>
  </main>;
}

function CurrentQuestion({ current, setCurrent, index, demoScenario, error, onBack, onNext }) {
  const spec = CURRENT_STEPS[index];
  const value = current[spec.key];
  return <main className="onboard-page">
    <Header progress={Math.round(((index + 1) / 9) * 100)} label={`${index + 1}/9`} onBack={onBack} />
    <section className="question-card">
      <span className="candidate-chip">{spec.kicker}</span>
      <h1>{spec.title}</h1><p>{spec.help}</p><Prefill demoScenario={demoScenario} />
      <div className="answer-area">
        {spec.type === "text" ? <input autoFocus value={value} onChange={(e) => setCurrent((p) => ({ ...p, [spec.key]: e.target.value }))} placeholder="예: 서울 마포구 연남동" onKeyDown={(e) => e.key === "Enter" && onNext()} /> :
          <><div className="unit-input"><input autoFocus type="number" min="0" value={value} onChange={(e) => setCurrent((p) => ({ ...p, [spec.key]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && onNext()} /><b>만원</b></div><MoneyChips field={spec.key} onPick={(v) => setCurrent((p) => ({ ...p, [spec.key]: String(v) }))} /></>}
      </div>
      {error && <div className="error-text">{error}</div>}
      <button className="primary next" onClick={onNext}>다음</button>
    </section>
  </main>;
}

function MoneyChips({ field, onPick }) {
  const values = field === "monthly_sales" ? [1500, 2500, 3500] : field === "deposit" ? [1000, 3000, 5000] : field === "available_self_fund" ? [500, 1000, 2000] : [300, 700, 1200];
  return <div className="quick-row money-chips">{values.map((v) => <button key={v} type="button" onClick={() => onPick(v)}>{v.toLocaleString()}만원</button>)}</div>;
}

function CandidateCount({ candidateCount, demoScenario, onBack, onChoose }) {
  return <main className="onboard-page">
    <Header progress={78} label="7/9" onBack={onBack} />
    <section className="question-card">
      <span className="candidate-chip">후보지 · 7</span>
      <h1>비교하고 싶은 후보지는 몇 곳인가요?</h1><p>최대 3곳까지 A·B·C 후보로 추가할 수 있어요.</p><Prefill demoScenario={demoScenario} />
      <div className="choice-grid three">{[1, 2, 3].map((x) => <button key={x} className={candidateCount === x ? "selected" : ""} onClick={() => onChoose(x)}>{x}곳<small>{x === 1 ? "후보 A만 분석" : x === 2 ? "후보 A·B 비교" : "후보 A·B·C 비교"}</small></button>)}</div>
    </section>
  </main>;
}

const CANDIDATE_FIELDS = [
  ["monthly_rent", "월세"], ["maintenance_fee", "관리비"], ["other_fixed_cost", "기타 고정비"],
  ["deposit", "보증금"], ["interior_cost", "인테리어비"], ["moving_cost", "이사비"],
  ["restoration_cost", "원상복구비"], ["rights_fee", "권리금"], ["other_moving_cost", "기타 이전비"],
];

function CandidateForm({ candidate, index, count, demoScenario, error, onChange, onBack, onNext }) {
  const id = SITE_IDS[index];
  return <main className="onboard-page candidate-page">
    <Header progress={89} label={`후보 ${id}`} onBack={onBack} />
    <section className="question-card candidate-question-card">
      <span className="candidate-chip">후보 {id} · {index + 1}/{count}</span>
      <h1>후보 {id}의 조건을 알려주세요.</h1><p>후보별 월 운영비와 일회성 이전비를 따로 계산합니다.</p><Prefill demoScenario={demoScenario} />
      <div className="candidate-form-card">
        <label className="wide-field"><span>주소</span><input value={candidate.name} onChange={(e) => onChange("name", e.target.value)} placeholder="예: 서울 성동구 성수동" /></label>
        <div className="form-section-label">매달 반복되는 비용</div>
        <div className="field-grid">
          {CANDIDATE_FIELDS.slice(0, 3).map(([key, label]) => <MoneyField key={key} label={label} value={candidate[key]} onChange={(v) => onChange(key, v)} />)}
        </div>
        <div className="inline-help">월세 + 관리비 + 기타 고정비를 합쳐 현재 매장 월 고정비와 비교합니다.</div>
        <div className="form-section-label">한 번 발생하는 이전비</div>
        <div className="field-grid">
          {CANDIDATE_FIELDS.slice(3).map(([key, label]) => <MoneyField key={key} label={label} value={candidate[key]} onChange={(v) => onChange(key, v)} />)}
          <label className="compact-field"><span>예상 휴업일수</span><div className="mini-unit"><input type="number" min="0" value={candidate.closed_days} onChange={(e) => onChange("closed_days", e.target.value)} /><b>일</b></div></label>
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
      <button className="primary next" onClick={onNext}>{index + 1 < count ? `후보 ${SITE_IDS[index + 1]} 확인하기` : "입력 완료"}</button>
    </section>
  </main>;
}

function MoneyField({ label, value, onChange }) {
  return <label className="compact-field"><span>{label}</span><div className="mini-unit"><input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)} /><b>만원</b></div></label>;
}

function BranchCheck({ current, candidates, lowerCount, error, onBack, onNext }) {
  return <main className="onboard-page">
    <Header progress={100} label="분석" onBack={onBack} />
    <section className="question-card">
      <span className="candidate-chip">입력 완료</span>
      <h1>후보지 비용을 현재 매장과 비교했어요.</h1><p>자발/비자발을 보여주지 않고 후보별로 다음 질문과 결과 포커스만 달라집니다.</p>
      <div className="branch-summary"><div><span>현재 매장 월 고정비</span><b>{money(current.fixed_cost)}만원</b></div>{candidates.map((c) => <div key={c.site_id}><span>후보 {c.site_id} 월 운영비</span><b>{money(monthlyCost(c))}만원</b></div>)}</div>
      <div className="branch-tip">{lowerCount ? `현재보다 월 운영비가 낮거나 같은 후보가 ${lowerCount}곳 있습니다. 다음 단계에서 목표 회수기간을 한 번 더 물어봅니다.` : "모든 후보의 월 운영비가 현재보다 높습니다. 회수기간 추가 질문 없이 바로 분석합니다."}</div>
      {error && <div className="error-text">{error}</div>}
      <button className="primary next" onClick={onNext}>계속</button>
    </section>
  </main>;
}

function Recovery({ months, setMonths, onBack, onNext }) {
  return <main className="onboard-page">
    <Header progress={100} label="추가" onBack={onBack} />
    <section className="question-card">
      <span className="candidate-chip">추가 질문</span>
      <h1>이전비용을 몇 개월 안에 회수하고 싶어요?</h1><p>1개월부터 36개월까지 원하는 기간을 직접 조절해보세요.</p>
      <div className="slider-box"><strong>{months}개월</strong><input type="range" min="1" max="36" step="1" value={months} onChange={(e) => setMonths(Number(e.target.value))}/><div className="slider-label"><span>1개월</span><span>12개월</span><span>24개월</span><span>36개월</span></div><div className="quick-row">{[12,24,36].map((m) => <button key={m} className={months === m ? "selected" : ""} onClick={() => setMonths(m)}>{m}개월</button>)}</div></div>
      <div className="branch-tip"><b>선택한 기간에 맞춰 필요매출을 다시 계산합니다.</b><br/>기간이 짧을수록 매달 회수해야 하는 금액이 커져 목표 필요매출도 높아집니다.</div>
      <button className="primary next" onClick={onNext}>이 기간으로 계산하기</button>
    </section>
  </main>;
}

const LOADING_CORE = ["후보지 조건을 계산하고 있어요", "상권 ML 데이터를 확인하고 있어요", "후보별 정책금융을 찾고 있어요"];
const LOADING_AI = "AI가 후보 간 차이를 해석하고 있어요";

function LoadingScreen({ stage }) {
  const [i, setI] = useState(0);
  // core 단계 문구를 한 번 빠르게 훑고, ai 단계로 넘어가면(실제 병목) 그 문구에서 멈춘다 —
  // 가짜 퍼센트 없이 지금 정말 무엇을 기다리는지만 보여준다.
  useEffect(() => {
    if (stage === "ai") return;
    const t = setInterval(() => setI((x) => Math.min(x + 1, LOADING_CORE.length - 1)), 1400);
    return () => clearInterval(t);
  }, [stage]);
  const label = stage === "ai" ? LOADING_AI : LOADING_CORE[i];
  return (
    <main className="loading-page">
      <div className="spinner" />
      <h2>{label}</h2>
      <p>{stage === "ai" ? "AI 해석에는 10~20초 정도 걸릴 수 있어요. 결과는 해석까지 끝난 뒤 한 번에 보여드려요." : "잠시만 기다려주세요."}</p>
    </main>
  );
}

function cleanError(text = "") {
  try { const parsed = JSON.parse(text); return parsed.detail || text; } catch { return String(text).slice(0, 240); }
}
