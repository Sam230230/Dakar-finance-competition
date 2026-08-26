import { useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";
const DEMO_MODE = String(import.meta.env.VITE_DEMO_MODE ?? "true").toLowerCase() !== "false";

const SITE_META = {
  current: { label: "현재", full: "현재 매장", color: "#111111" },
  A: { label: "A", full: "후보 A", color: "#ff5c35" },
  B: { label: "B", full: "후보 B", color: "#2357ff" },
  C: { label: "C", full: "후보 C", color: "#7d5cff" },
};

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
  target_months: "24",
});

const DEMO_INPUT = {
  cur: {
    business_name: "스테이 커피",
    current_site: "서울 마포구 양화로 33",
    monthly_sales: "2800",
    variable_cost: "1120",
    fixed_cost: "930",
    deposit: "2000",
    available_cash: "1500",
  },
  cands: [
    { site_id: "A", name: "서울 마포구 망원로 50", monthly_rent: "250", maintenance_fee: "20", other_fixed_cost: "450", deposit: "3000", interior_cost: "2500", moving_cost: "500", restoration_cost: "300", rights_fee: "0", other_moving_cost: "0", closed_days: "15", target_months: "24" },
    { site_id: "B", name: "서울 마포구 월드컵로13길 18", monthly_rent: "220", maintenance_fee: "15", other_fixed_cost: "410", deposit: "2500", interior_cost: "1700", moving_cost: "450", restoration_cost: "300", rights_fee: "0", other_moving_cost: "0", closed_days: "10", target_months: "24" },
    { site_id: "C", name: "서울 마포구 동교로 162", monthly_rent: "310", maintenance_fee: "25", other_fixed_cost: "460", deposit: "3500", interior_cost: "2100", moving_cost: "500", restoration_cost: "300", rights_fee: "0", other_moving_cost: "0", closed_days: "12", target_months: "24" },
  ],
};

export default function App() {
  const [screen, setScreen] = useState("onboarding");
  const [relocationMode, setRelocationMode] = useState("voluntary");
  const [result, setResult] = useState(null);
  const [marketRows, setMarketRows] = useState([]);
  const [industryCode, setIndustryCode] = useState("CS100010");
  const [industries, setIndustries] = useState([{ industry_cd: "CS100010", industry_nm: "커피-음료" }]);
  const [cur, setCur] = useState({ business_name: "", current_site: "", monthly_sales: "", variable_cost: "", fixed_cost: "", deposit: "", available_cash: "" });
  const [cands, setCands] = useState([emptyCandidate("A"), emptyCandidate("B"), emptyCandidate("C")]);
  const [places, setPlaces] = useState({ current: null, A: null, B: null, C: null });
  const [activeSite, setActiveSite] = useState("current");
  const [searching, setSearching] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/industries`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => Array.isArray(rows) && rows.length && setIndustries(rows))
      .catch(() => {});
  }, []);

  const num = (v) => (v === "" || v == null ? 0 : Number(v));
  const currentMap = places.current ? toMapPoint(places.current, cur.business_name || "현재 매장") : null;
  const candidateMaps = cands.map((c) => (places[c.site_id] ? toMapPoint(places[c.site_id], c.name || `후보 ${c.site_id}`) : null)).filter(Boolean);

  const updateCurrent = (key) => (e) => {
    const value = e.target.value;
    setCur((prev) => ({ ...prev, [key]: value }));
    if (key === "current_site") setPlaces((prev) => ({ ...prev, current: null }));
  };

  const updateCandidate = (index, key) => (e) => {
    const value = e.target.value;
    const id = cands[index].site_id;
    setCands((prev) => prev.map((c, i) => (i === index ? { ...c, [key]: value } : c)));
    if (key === "name") setPlaces((prev) => ({ ...prev, [id]: null }));
  };

  async function resolveAddress(key, address, quiet = false) {
    if (!address?.trim()) return null;
    if (!quiet) setSearching(key);
    try {
      const res = await fetch(`${API_BASE}/commercial-area`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const raw = await res.json();
      const place = normalizePlace(raw, key, key === "current" ? cur.business_name || "현재 매장" : `후보 ${key}`);
      setPlaces((prev) => ({ ...prev, [key]: place }));
      setActiveSite(key);
      if (!quiet) setNotice(`${SITE_META[key].full} · ${place.trdar_nm || "상권 경계 확인"}`);
      return place;
    } catch (err) {
      if (!quiet) setNotice(`주소 검색 실패 · ${cleanError(err.message)}`);
      return null;
    } finally {
      if (!quiet) setSearching("");
    }
  }

  async function locateByMapClick({ lat, lng }) {
    try {
      const res = await fetch(`${API_BASE}/commercial-area/by-point`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      if (!res.ok) throw new Error(await res.text());
      const raw = await res.json();
      const key = activeSite;
      const place = normalizePlace(raw, key, SITE_META[key].full);
      setPlaces((prev) => ({ ...prev, [key]: place }));
      const label = `지도 선택 · ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      if (key === "current") setCur((prev) => ({ ...prev, current_site: label }));
      else setCands((prev) => prev.map((c) => (c.site_id === key ? { ...c, name: label } : c)));
      setNotice(`${SITE_META[key].full} 위치를 지도에서 지정했습니다.`);
    } catch (err) {
      setNotice(`지도 위치 지정 실패 · ${cleanError(err.message)}`);
    }
  }

  async function fillDemo() {
    setScreen("input");
    setCur({ ...DEMO_INPUT.cur });
    setCands(DEMO_INPUT.cands.map((c) => ({ ...c })));
    setActiveSite("current");
    try {
      const res = await fetch(`${API_BASE}/demo-locations`);
      if (!res.ok) throw new Error(await res.text());
      const rows = await res.json();
      const next = { current: null, A: null, B: null, C: null };
      rows.forEach((row) => {
        next[row.site_id] = normalizePlace(row, row.site_id, SITE_META[row.site_id].full);
      });
      setPlaces(next);
      setNotice("데모 위치와 서울시 상권 경계를 불러왔습니다.");
    } catch {
      setPlaces({ current: null, A: null, B: null, C: null });
      setNotice("데모 입력값을 채웠습니다. 주소 검색 또는 지도 클릭으로 위치를 지정하세요.");
    }
  }

  async function ensureLocations(activeCandidates) {
    const currentResolved = places.current || (DEMO_MODE && cur.current_site === DEMO_INPUT.cur.current_site ? null : await resolveAddress("current", cur.current_site, true));
    const candidateResolved = [];
    for (const c of activeCandidates) {
      candidateResolved.push(places[c.site_id] || await resolveAddress(c.site_id, c.name, true));
    }
    return [currentResolved, ...candidateResolved].filter(Boolean);
  }

  async function submit(e) {
    e.preventDefault();
    const activeCandidates = cands.filter((c) => c.name.trim());
    if (!cur.current_site.trim()) return setNotice("현재 매장 위치를 입력해주세요.");
    if (!activeCandidates.length) return setNotice("후보지를 1개 이상 입력해주세요.");
    if (relocationMode === "involuntary" && activeCandidates.length < 3) return setNotice("현재 매장을 유지하기 어려운 경우 후보 A/B/C 세 곳을 입력해주세요.");
    if (num(cur.monthly_sales) <= 0) return setNotice("월평균 매출을 입력해주세요.");

    setScreen("loading");
    const payload = {
      business_name: cur.business_name || "우리 매장",
      industry: industries.find((x) => x.industry_cd === industryCode)?.industry_nm || "커피-음료",
      can_continue_current: relocationMode === "voluntary",
      current_operating_status: "영업 중",
      current: {
        monthly_sales: num(cur.monthly_sales),
        variable_cost: num(cur.variable_cost),
        fixed_cost: num(cur.fixed_cost),
        deposit: num(cur.deposit),
        available_cash: num(cur.available_cash),
      },
      candidates: activeCandidates.map((c) => ({
        site_id: c.site_id,
        name: c.name,
        monthly_rent: num(c.monthly_rent),
        maintenance_fee: num(c.maintenance_fee),
        other_fixed_cost: num(c.other_fixed_cost),
        deposit: num(c.deposit),
        interior_cost: num(c.interior_cost),
        moving_cost: num(c.moving_cost),
        restoration_cost: num(c.restoration_cost),
        rights_fee: num(c.rights_fee),
        other_moving_cost: num(c.other_moving_cost),
        closed_days: num(c.closed_days),
        target_months: num(c.target_months) || 24,
      })),
    };

    try {
      const [analysis, resolved] = await Promise.all([
        // explain=true는 항상 요청한다. LLM 생성 여부(OPENAI_API_KEY, ENABLE_LLM_EXPLANATION)는
        // 백엔드가 판단해 Retrieval-only로 안전하게 fallback한다 — DEMO_MODE(상권 Mock 여부)와
        // AI 설명 생성 여부는 별개다.
        fetch(`${API_BASE}/staymove?explain=true`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(async (r) => {
          if (!r.ok) throw new Error(await r.text());
          return r.json();
        }),
        ensureLocations(activeCandidates),
      ]);

      const codes = [...new Set(resolved.map((p) => p.trdar_cd).filter(Boolean))];
      let markets = [];
      if (codes.length) {
        const mr = await fetch(`${API_BASE}/market-context`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trdar_codes: codes, industry_code: industryCode }),
        });
        if (mr.ok) markets = await mr.json();
      }
      setResult(analysis);
      setMarketRows(markets);
      setScreen("result");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setNotice(`분석 실패 · ${cleanError(err.message)}`);
      setScreen("input");
    }
  }

  const reset = () => {
    setScreen("onboarding");
    setResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="app-shell">
      <TopBar onHome={reset} onDemo={fillDemo} demoMode={DEMO_MODE} result={screen === "result"} />
      {notice && <div className="toast-line" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>닫기</button></div>}
      {screen === "onboarding" ? (
        <OnboardingScreen
          onChoose={(mode) => { setRelocationMode(mode); setScreen("input"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        />
      ) : screen === "loading" ? (
        <LoadingScreen />
      ) : screen === "result" ? (
        <ResultScreen
          data={result}
          marketRows={marketRows}
          places={places}
          current={currentMap}
          candidates={candidateMaps}
          industry={industries.find((x) => x.industry_cd === industryCode)?.industry_nm || industryCode}
          onReset={reset}
        />
      ) : (
        <InputScreen
          relocationMode={relocationMode}
          cur={cur}
          cands={cands}
          places={places}
          industries={industries}
          industryCode={industryCode}
          activeSite={activeSite}
          searching={searching}
          loading={screen === "loading"}
          currentMap={currentMap}
          candidateMaps={candidateMaps}
          onCurrent={updateCurrent}
          onCandidate={updateCandidate}
          onIndustry={setIndustryCode}
          onActiveSite={setActiveSite}
          onSearch={resolveAddress}
          onMapClick={locateByMapClick}
          onDemo={fillDemo}
          onBack={() => setScreen("onboarding")}
          onSubmit={submit}
        />
      )}
    </div>
  );
}

function OnboardingScreen({ onChoose }) {
  return (
    <main className="onboarding-page">
      <section className="page-width onboarding-hero">
        <span className="eyebrow">START</span>
        <h1>현재 매장에서<br />계속 영업할 수 있나요?</h1>
        <p>사용자가 자발적·비자발적이라는 용어를 고르는 대신, 현재 점포를 선택지로 둘 수 있는지만 먼저 확인합니다.</p>
        <div className="onboarding-options">
          <button type="button" className="onboarding-option stay" onClick={() => onChoose("voluntary")}>
            <span>YES</span><strong>네, 유지할 수도 있어요</strong><small>현재 매장은 실제 선택 가능한 Stay 옵션입니다 · 현재 매장 ↔ 후보지 비교</small><b>자발적 이전 흐름 ↗</b>
          </button>
          <button type="button" className="onboarding-option move" onClick={() => onChoose("involuntary")}>
            <span>NO</span><strong>아니요, 이전해야 해요</strong><small>현재 매장은 기준점으로만 사용하고, 이전 후보끼리 비교합니다 · 후보 A ↔ B ↔ C</small><b>비자발적 이전 흐름 ↗</b>
          </button>
        </div>
      </section>
    </main>
  );
}

const LOADING_STEPS = [
  "이전 비용을 계산하고 있습니다",
  "후보 상권을 확인하고 있습니다",
  "지역별 정책금융을 찾고 있습니다",
];

function LoadingScreen() {
  const [stepIndex, setStepIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStepIndex((i) => (i + 1) % LOADING_STEPS.length), 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <main className="loading-page">
      <section className="page-width loading-hero">
        <span className="eyebrow">ANALYZING</span>
        <h1>분석하고 있습니다</h1>
        <ul className="loading-steps">
          {LOADING_STEPS.map((label, i) => (
            <li key={label} className={i === stepIndex ? "active" : i < stepIndex ? "done" : ""}>
              <i />{label}
            </li>
          ))}
        </ul>
        <p className="loading-note">정책 RAG 모델 로딩 때문에 첫 분석은 시간이 다소 걸릴 수 있습니다.</p>
      </section>
    </main>
  );
}

function TopBar({ onHome, onDemo, demoMode, result }) {
  return (
    <header className="topbar">
      <div className="page-width topbar-inner">
        <button type="button" className="wordmark" onClick={onHome}>Stay or Move</button>
        <div className="topbar-actions">
          {demoMode && <span className="mode-pill"><i /> DEMO</span>}
          <button type="button" className="nav-link" onClick={onDemo}>데모 불러오기</button>
          {result && <button type="button" className="nav-button" onClick={onHome}>새 분석</button>}
        </div>
      </div>
    </header>
  );
}

function InputScreen({ relocationMode, cur, cands, places, industries, industryCode, activeSite, searching, loading, currentMap, candidateMaps, onCurrent, onCandidate, onIndustry, onActiveSite, onSearch, onMapClick, onDemo, onBack, onSubmit }) {
  const activeCandIndex = Math.max(0, cands.findIndex((c) => c.site_id === activeSite));
  const contractSite = activeSite === "current" ? "A" : activeSite;
  const contractIndex = Math.max(0, cands.findIndex((c) => c.site_id === contractSite));
  const activeContract = cands[contractIndex];

  return (
    <main>
      <section className="hero page-width">
        <h1>Stay or Move</h1>
        <div className="hero-meta">
          <span>{relocationMode === "voluntary" ? "Stay vs Move" : "Move vs Move"}</span><span>+</span><span>서울시 상권 데이터</span><span>+</span><span>정책금융 RAG</span>
        </div>
      </section>

      <form onSubmit={onSubmit}>
        <section className="map-workspace page-width">
          <div className="search-rail">
            <div className="rail-head">
              <div><span className="eyebrow">01</span><h2>매장 위치</h2></div>
              <div className="rail-actions"><button type="button" className="micro-button" onClick={onBack}>이전</button><button type="button" className="micro-button" onClick={onDemo}>데모</button></div>
            </div>
            <p className="rail-help">주소를 검색하거나, 항목을 선택한 뒤 지도에서 직접 위치를 클릭하세요.</p>
            <LocationSearchRow
              id="current"
              value={cur.current_site}
              place={places.current}
              active={activeSite === "current"}
              busy={searching === "current"}
              onActivate={() => onActiveSite("current")}
              onChange={onCurrent("current_site")}
              onSearch={() => onSearch("current", cur.current_site)}
            />
            {cands.map((c, index) => (
              <LocationSearchRow
                key={c.site_id}
                id={c.site_id}
                value={c.name}
                place={places[c.site_id]}
                active={activeSite === c.site_id}
                busy={searching === c.site_id}
                optional={relocationMode === "voluntary" && c.site_id !== "A"}
                onActivate={() => onActiveSite(c.site_id)}
                onChange={onCandidate(index, "name")}
                onSearch={() => onSearch(c.site_id, c.name)}
              />
            ))}
            <div className="rail-foot">
              <span className="mouse-icon">＋</span>
              <span><b>{SITE_META[activeSite].full}</b> 위치를 지도 클릭으로 지정 가능</span>
            </div>
          </div>
          <div className="map-frame">
            <MapView
              current={currentMap}
              candidates={candidateMaps}
              selectedId={activeSite === "current" ? null : activeSite}
              activeKey={activeSite}
              showBoundaries
              onMapClick={onMapClick}
            />
            <div className="map-top-chip">NAVER MAP</div>
            <div className="map-bottom-legend">
              {Object.entries(SITE_META).map(([key, meta]) => <span key={key}><i style={{ background: meta.color }} />{meta.label}</span>)}
            </div>
          </div>
        </section>

        <section className="data-form-section">
          <div className="page-width form-split">
            <div className="form-intro">
              <span className="eyebrow">02</span>
              <h2>{relocationMode === "voluntary" ? "현재 매장" : "현재 매장 — 재무 기준점"}</h2>
              <p>{relocationMode === "voluntary" ? "현재 매장을 실제 선택 가능한 Stay 옵션으로 두고 후보지 Move와 비교합니다." : "현재 매장은 더 이상 선택 가능한 옵션이 아니며, Rule Engine 계산의 기준점(과거 실적·비용)으로만 사용합니다."}</p>
            </div>
            <div className="form-card">
              <div className="form-grid">
                <TextField label="사업체명" value={cur.business_name} onChange={onCurrent("business_name")} placeholder="예: 스테이 커피" />
                <SelectField label="업종" value={industryCode} onChange={(e) => onIndustry(e.target.value)} options={industries} />
                <MoneyField label="월평균 매출" value={cur.monthly_sales} onChange={onCurrent("monthly_sales")} placeholder="2,800" />
                <MoneyField label="월평균 변동비" value={cur.variable_cost} onChange={onCurrent("variable_cost")} placeholder="1,120" />
                <MoneyField label="월평균 고정비" value={cur.fixed_cost} onChange={onCurrent("fixed_cost")} placeholder="930" />
                <MoneyField label="현재 보증금" value={cur.deposit} onChange={onCurrent("deposit")} placeholder="2,000" />
                <MoneyField label="보유 가용현금" value={cur.available_cash} onChange={onCurrent("available_cash")} placeholder="1,500" />
              </div>
            </div>
          </div>
        </section>

        <section className="page-width candidate-form-section">
          <div className="form-intro horizontal-intro">
            <div><span className="eyebrow">03</span><h2>후보 조건</h2></div>
            <div className="site-tabs">
              {cands.map((c) => (
                <button key={c.site_id} type="button" className={activeContract.site_id === c.site_id ? "site-tab active" : "site-tab"} onClick={() => onActiveSite(c.site_id)}>
                  <span style={{ background: SITE_META[c.site_id].color }}>{c.site_id}</span>
                  <small>{c.name ? compactAddress(c.name) : relocationMode === "involuntary" ? "필수" : c.site_id === "A" ? "필수" : "선택"}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="contract-sheet">
            <div className="contract-heading">
              <div className="contract-site-badge" style={{ background: SITE_META[activeContract.site_id].color }}>{activeContract.site_id}</div>
              <div><strong>{activeContract.name || `후보 ${activeContract.site_id}`}</strong><span>만원 단위</span></div>
            </div>
            <div className="form-grid contract-grid">
              <MoneyField label="월세" value={activeContract.monthly_rent} onChange={onCandidate(contractIndex, "monthly_rent")} placeholder="250" />
              <MoneyField label="관리비" value={activeContract.maintenance_fee} onChange={onCandidate(contractIndex, "maintenance_fee")} placeholder="20" />
              <MoneyField label="기타 고정비" value={activeContract.other_fixed_cost} onChange={onCandidate(contractIndex, "other_fixed_cost")} placeholder="450" />
              <MoneyField label="보증금" value={activeContract.deposit} onChange={onCandidate(contractIndex, "deposit")} placeholder="3,000" />
              <MoneyField label="인테리어비" value={activeContract.interior_cost} onChange={onCandidate(contractIndex, "interior_cost")} placeholder="2,500" />
              <MoneyField label="이사비" value={activeContract.moving_cost} onChange={onCandidate(contractIndex, "moving_cost")} placeholder="500" />
              <MoneyField label="원상회복비" value={activeContract.restoration_cost} onChange={onCandidate(contractIndex, "restoration_cost")} placeholder="300" />
              <MoneyField label="권리금" value={activeContract.rights_fee} onChange={onCandidate(contractIndex, "rights_fee")} placeholder="0" />
              <MoneyField label="기타 이전비" value={activeContract.other_moving_cost} onChange={onCandidate(contractIndex, "other_moving_cost")} placeholder="0" />
              <NumberField label="예상 휴업일수" value={activeContract.closed_days} onChange={onCandidate(contractIndex, "closed_days")} placeholder="15" suffix="일" />
              <TargetPeriodField label="목표 회수기간" value={activeContract.target_months} onChange={onCandidate(contractIndex, "target_months")} />
            </div>
          </div>
          <div className="analysis-action">
            <div><span>{relocationMode === "voluntary" ? "현재 Stay와 후보 Move를 계산합니다." : "후보 A/B/C를 동일 기준으로 비교합니다."}</span><small>Rule Engine → 상권 데이터 → 추가 필요자금 → 정책금융 RAG</small></div>
            <button className="analysis-button" disabled={loading} type="submit">{loading ? "분석 중" : "분석하기"}<b>↗</b></button>
          </div>
        </section>
      </form>
    </main>
  );
}

function ResultScreen({ data, marketRows, places, current, candidates, industry, onReset }) {
  const analyses = data?.candidates || [];
  const [selectedId, setSelectedId] = useState(analyses[0]?.site_id || "A");
  const selected = useMemo(() => analyses.find((c) => c.site_id === selectedId) || analyses[0] || {}, [analyses, selectedId]);
  const marketMap = useMemo(() => Object.fromEntries((marketRows || []).filter((r) => r.metric).map((r) => [String(r.trdar_cd), r.metric])), [marketRows]);
  const currentMetric = places.current?.trdar_cd ? marketMap[String(places.current.trdar_cd)] : null;
  const candidateMetric = places[selectedId]?.trdar_cd ? marketMap[String(places[selectedId].trdar_cd)] : null;
  const targetFocus = (selected.target_periods || []).find((x) => x.months === Number(selected.target_months || 24)) || (selected.target_periods || []).find((x) => x.months === 24);
  const scenario95 = (selected.scenarios || []).find((x) => Math.round(x.retention * 100) === 95);

  const narrative = buildNarrative(selected, candidateMetric, currentMetric, targetFocus, scenario95, data?.comparison_mode);

  return (
    <main className="result-page">
      <section className="result-hero page-width">
        <div>
          <span className="eyebrow">{data?.comparison_mode === "STAY_VS_MOVE" ? "VOLUNTARY · STAY VS MOVE" : "INVOLUNTARY · MOVE VS MOVE"}</span>
          <h1 className="result-title-sentence">{data?.comparison_mode === "STAY_VS_MOVE" ? "현재 매장을 유지할 때와 이전할 때를 비교해보세요" : "이전 후보별 부담과 지원 가능성을 비교해보세요"}</h1>
        </div>
        <div className="result-switch">
          {data?.comparison_mode === "STAY_VS_MOVE" ? <span className="stay-option"><i />STAY · 현재 매장</span> : <span className="baseline-option">현재 기준 · 현재 매장</span>}
          {analyses.map((c) => <button type="button" key={c.site_id} className={selectedId === c.site_id ? "active" : ""} onClick={() => setSelectedId(c.site_id)}><i style={{ background: SITE_META[c.site_id].color }} />MOVE {c.site_id}</button>)}
        </div>
      </section>

      <section className="page-width kpi-ribbon">
        <KpiCard index="01" label="필요 매출 유지율" value={pct(selected.required_retention)} sub={`최소 월 ${formatWon(selected.min_required_sales)}만원`} emphasis />
        <KpiCard index="02" label={`${targetFocus?.months || 24}개월 회수 목표`} value={targetFocus ? pct(targetFocus.required_retention) : "-"} sub={targetFocus ? `월 ${formatWon(targetFocus.required_sales)}만원` : "-"} />
        <KpiCard index="03" label="매출 95% 유지 시" value={scenario95?.payback_months ? `${scenario95.payback_months}개월` : "회수 어려움"} sub="실제 이전비 기준" />
        <KpiCard index="04" label="추가 필요 이전자금" value={`${formatWon(selected.additional_fund_needed)}만`} sub={`초기 소요 ${formatWon(selected.initial_capital)}만 · 가용현금 ${formatWon(selected.available_cash)}만`} />
      </section>
      <p className="page-width fund-note">추가 필요 이전자금은 초기 이전 소요자금에서 현재 보유 가용현금을 제외한 금액입니다. 이 금액과 후보지역을 기준으로 활용 가능한 정책금융을 탐색했습니다.</p>

      <section className="page-width result-map-section">
        <div className="map-frame result-map-frame">
          <MapView current={current} candidates={candidates} selectedId={selectedId} activeKey={selectedId} showBoundaries />
          <div className="map-top-chip">{data?.comparison_mode === "STAY_VS_MOVE" ? `STAY ↔ MOVE ${selectedId}` : `BASELINE ↔ MOVE ${selectedId}`}</div>
        </div>
        <aside className="result-place-card">
          <span className="eyebrow">LOCATION</span>
          <div className="place-badge" style={{ background: SITE_META[selectedId].color }}>{selectedId}</div>
          <h2>{places[selectedId]?.trdar_nm || `후보 ${selectedId}`}</h2>
          <p>{places[selectedId]?.road_address || selected.name}</p>
          <dl>
            <div><dt>상권코드</dt><dd>{places[selectedId]?.trdar_cd || "-"}</dd></div>
            <div><dt>{data?.comparison_mode === "STAY_VS_MOVE" ? "Stay 상권" : "기준 상권"}</dt><dd>{places.current?.trdar_nm || "-"}</dd></div>
            <div><dt>분석 업종</dt><dd>{industry}</dd></div>
          </dl>
        </aside>
      </section>

      <section className="market-section">
        <div className="page-width">
          <div className="section-heading"><div><span className="eyebrow">SEOUL DATA</span><h2>현재와 후보 상권</h2></div><p>같은 업종, 실제 공개데이터 기준</p></div>
          <div className="market-comparison">
            <MetricCompare label="동종업종 매출 YoY" current={currentMetric?.sales_yoy} candidate={candidateMetric?.sales_yoy} suffix="%" />
            <MetricCompare label="동종업종 폐업률" current={currentMetric?.closure_rate} candidate={candidateMetric?.closure_rate} suffix="%" invert />
            <ChangeCompare current={currentMetric} candidate={candidateMetric} />
          </div>
          <div className="source-line">매출 {periodText(candidateMetric?.sales_period)} · 폐업률 {periodText(candidateMetric?.store_period)} · 상권변화 {periodText(candidateMetric?.change_period)}</div>
        </div>
      </section>

      <section className="page-width scenario-section">
        <div className="section-heading"><div><span className="eyebrow">SCENARIO</span><h2>기간 ↔ 매출</h2></div><p>예측이 아니라 조건 계산</p></div>
        <div className="scenario-grid">
          <div className="scenario-card">
            <div className="scenario-title"><strong>목표 회수기간</strong><span>기간 → 필요 매출</span></div>
            {(selected.target_periods || []).map((x) => (
              <div className="scenario-row" key={x.months}><span>{x.months}<small>개월</small></span><div className="scenario-bar"><i style={{ width: `${Math.min(100, x.required_retention * 100)}%` }} /></div><b>{pct(x.required_retention)}</b><em>{formatWon(x.required_sales)}만</em></div>
            ))}
          </div>
          <div className="scenario-card dark-scenario">
            <div className="scenario-title"><strong>매출 유지 수준</strong><span>매출 → 회수기간</span></div>
            {(selected.scenarios || []).map((x) => (
              <div className="scenario-row" key={x.retention}><span>{Math.round(x.retention * 100)}<small>%</small></span><div className="scenario-bar"><i style={{ width: `${Math.min(100, x.retention * 100)}%` }} /></div><b>{x.payback_months == null ? "-" : `${x.payback_months}개월`}</b><em>{x.monthly_gain == null ? "" : `${x.monthly_gain >= 0 ? "+" : ""}${formatWon(x.monthly_gain)}만/월`}</em></div>
            ))}
          </div>
        </div>
      </section>

      <AiExplanationSection candidate={selected} comparisonSummary={data?.comparison_summary} comparisonMode={data?.comparison_mode} analysesCount={analyses.length} />

      <PolicySection candidate={selected} />

      <CandidateComparisonTable analyses={analyses} places={places} marketMap={marketMap} />

      <section className="insight-section">
        <div className="page-width insight-grid">
          <div><span className="eyebrow">SUMMARY</span><h2>판단 포인트</h2></div>
          <div className="insight-copy">{narrative.map((line, i) => <p key={i}>{line}</p>)}</div>
        </div>
      </section>

      <section className="page-width result-footer-action">
        <span>다른 후보를 비교하려면 입력 화면으로 돌아가세요.</span>
        <button type="button" onClick={onReset}>새 분석 ↗</button>
      </section>
    </main>
  );
}

function AiExplanationSection({ candidate, comparisonSummary, comparisonMode, analysesCount }) {
  const exp = candidate?.ai_explanation;
  if (!exp) return null;
  const sourceLinks = (exp.policy_summary || []).filter((p) => p.source_url).slice(0, 3);
  return (
    <section className="ai-explanation-section">
      <div className="page-width">
        <div className="section-heading">
          <div><span className="eyebrow">AI SUMMARY</span><h2>{exp.candidate_region ? `${exp.candidate_region}에서 확인할 AI 종합 설명` : "AI 종합 설명"}</h2></div>
          <p>Rule Engine 계산 결과 + 검색된 정책 근거만 이용해 생성 · 확정 승인·추천이 아닙니다</p>
        </div>
        <div className="ai-explanation-card">
          <div>
            <h4>재무 부담</h4>
            <p>{exp.financial_summary?.summary || "-"}</p>
          </div>
          <div>
            <h4>정책금융</h4>
            {(exp.policy_summary || []).length ? (
              <ul className="ai-policy-list">
                {exp.policy_summary.map((p, i) => (
                  <li key={`${p.policy_name}-${i}`}>
                    <strong>{p.policy_name}</strong>
                    {p.why_relevant && <span> · {p.why_relevant}</span>}
                    {p.caution && <em> ({p.caution})</em>}
                  </li>
                ))}
              </ul>
            ) : (
              <p>검색된 정책금융을 근거로 한 설명이 없습니다.</p>
            )}
          </div>
          <div>
            <h4>확인할 조건</h4>
            {exp.important_checks?.length ? (
              <ul className="ai-checks-list">
                {exp.important_checks.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            ) : (
              <p>추가로 확인할 조건이 없습니다.</p>
            )}
          </div>
          <p className="ai-narrative">{exp.candidate_interpretation}</p>
        </div>
        {comparisonMode === "MOVE_VS_MOVE" && analysesCount > 1 && comparisonSummary && (
          <div className="ai-comparison-card">
            <h4>후보 비교 요약</h4>
            <p>{comparisonSummary}</p>
          </div>
        )}
        <p className="ai-grounding-note">
          AI 설명은 아래 공식 정책자료와 Rule Engine 계산 결과를 기반으로 생성되었습니다.
          {sourceLinks.length > 0 && (
            <span className="ai-source-links">
              {sourceLinks.map((p, i) => (
                <a key={i} href={p.source_url} target="_blank" rel="noreferrer">{p.policy_name} ↗</a>
              ))}
            </span>
          )}
        </p>
      </div>
    </section>
  );
}

function PolicySection({ candidate }) {
  const rag = candidate?.policy_rag || {};
  const policies = rag.results || [];
  return (
    <section className="policy-section">
      <div className="page-width">
        <div className="section-heading"><div><span className="eyebrow">POLICY RAG</span><h2>{candidate?.candidate_region ? `${candidate.candidate_region}에서 확인할 정책금융` : "부족자금과 연결되는 정책금융"}</h2></div><p>Rule Engine의 추가 필요 이전자금 + 후보 자치구 기준</p></div>
        <div className="policy-context">
          <div><span>추가 필요 이전자금</span><strong>{formatWon(candidate?.additional_fund_needed)}만원</strong></div>
          <div><span>후보지역</span><strong>{candidate?.candidate_region || "확인 필요"}</strong></div>
          <div><span>검색 상태</span><strong>{rag.status === "ok" ? `${policies.length}건 확인` : rag.status === "not_needed" ? "추가자금 없음" : "확인 필요"}</strong></div>
        </div>
        {policies.length ? <div className="policy-grid">{policies.map((p, i) => (
          <article className="policy-card" key={`${p.name}-${i}`}>
            <div className="policy-card-head">
              <span>{p.region_slot}</span>
              <span className={`status-badge ${statusTone(p.application_status)}`}>{p.application_status}</span>
              {p.source_verification_needed && <span className="status-badge tone-check">출처 추가 확인 필요</span>}
              <b>{p.support_type}</b>
            </div>
            <h3>{p.name}</h3>
            <p>{p.agency}</p>
            {p.source_note && <p className="policy-source-note">{p.source_note}</p>}
            <dl>
              <div><dt>자금용도</dt><dd>{p.fund_use}</dd></div>
              <div><dt>지원한도</dt><dd>{p.amount_limit}</dd></div>
              <div><dt>금리</dt><dd>{p.interest_rate}</dd></div>
              <div><dt>업력</dt><dd>{p.business_age_requirement}</dd></div>
              <div><dt>신청기간</dt><dd>{p.application_period}</dd></div>
            </dl>
            <div className="policy-card-foot">
              <span className={p.eligibility_needs_check ? "needs-check" : "ok-check"}>{p.eligibility_note || (p.eligibility_needs_check ? "자격 추가 확인 필요" : "검토 가능")}</span>
              {p.url && <a href={p.url} target="_blank" rel="noreferrer">공식 공고 ↗</a>}
            </div>
          </article>
        ))}</div> : <div className="policy-empty">{rag.message || "현재 조건에서 확인된 정책금융이 없습니다."}</div>}
        <div className="policy-warning">
          <p>※ 정책지원 후보가 검색되어도 지원금이 확보된 것으로 계산하지 않습니다. 실제 지원 여부는 해당 기관 심사를 통해 결정됩니다.</p>
          <p>※ 지원한도는 공고상 최대 지원한도이며 실제 승인금액과 다를 수 있습니다. 추가 필요 이전자금에서 자동으로 차감하지 않습니다.</p>
        </div>
      </div>
    </section>
  );
}

function CandidateComparisonTable({ analyses, places, marketMap }) {
  if (!analyses.length) return null;
  const rows = [
    { label: "최소 필요 월매출", render: (c) => `${formatWon(c.min_required_sales)}만원` },
    { label: "필요 매출 유지율", render: (c) => pct(c.required_retention) },
    { label: "초기 이전 소요자금", render: (c) => `${formatWon(c.initial_capital)}만원` },
    { label: "추가 필요 이전자금", render: (c) => `${formatWon(c.additional_fund_needed)}만원` },
    {
      label: "목표기간 필요매출",
      render: (c) => {
        const focus = (c.target_periods || []).find((x) => x.months === Number(c.target_months)) || (c.target_periods || [])[0];
        return focus ? `${focus.months}개월 · ${formatWon(focus.required_sales)}만원` : "-";
      },
    },
    {
      label: "후보 상권 매출 YoY",
      render: (c) => {
        const metric = places[c.site_id]?.trdar_cd ? marketMap[String(places[c.site_id].trdar_cd)] : null;
        return metric?.sales_yoy != null ? `${metric.sales_yoy.toFixed(1)}%` : "확인 필요";
      },
    },
    {
      label: "상권 안정성(변화지표)",
      render: (c) => {
        const metric = places[c.site_id]?.trdar_cd ? marketMap[String(places[c.site_id].trdar_cd)] : null;
        return metric?.change_index || "확인 필요";
      },
    },
    { label: "정책금융 수", render: (c) => `${(c.policy_rag?.results || []).length}건` },
    { label: "주요 정책", render: (c) => c.policy_rag?.results?.[0]?.name || "-" },
  ];
  return (
    <section className="page-width compare-section">
      <div className="section-heading"><div><span className="eyebrow">COMPARE</span><h2>후보 비교</h2></div><p>순위나 종합점수 없이 값만 비교합니다</p></div>
      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th>구분</th>
              {analyses.map((c) => (
                <th key={c.site_id}><span className="compare-th-badge" style={{ background: SITE_META[c.site_id].color }}>{c.site_id}</span>{c.name ? compactAddress(c.name) : `후보 ${c.site_id}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                {analyses.map((c) => <td key={c.site_id}>{row.render(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LocationSearchRow({ id, value, place, active, busy, optional, onActivate, onChange, onSearch }) {
  const meta = SITE_META[id];
  return (
    <div className={active ? "location-search active" : "location-search"} onClick={onActivate}>
      <div className="location-marker" style={{ background: meta.color }}>{meta.label}</div>
      <div className="location-search-body">
        <div className="location-label"><strong>{meta.full}</strong>{optional && <span>선택</span>}{place?.trdar_nm && <em>{place.trdar_nm}</em>}</div>
        <div className="address-search" onClick={(e) => e.stopPropagation()}>
          <input value={value} onChange={onChange} onFocus={onActivate} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearch(); } }} placeholder="도로명 주소 검색" />
          <button type="button" disabled={busy} onClick={onSearch}>{busy ? "…" : "검색"}</button>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ index, label, value, sub, emphasis }) {
  return <article className={emphasis ? "kpi-card emphasis" : "kpi-card"}><span>{index}</span><p>{label}</p><strong>{value}</strong><small>{sub}</small></article>;
}

function MetricCompare({ label, current, candidate, suffix = "", invert = false }) {
  const max = Math.max(Math.abs(Number(current) || 0), Math.abs(Number(candidate) || 0), 1);
  const curWidth = Math.max(8, Math.min(100, Math.abs(Number(current) || 0) / max * 100));
  const candWidth = Math.max(8, Math.min(100, Math.abs(Number(candidate) || 0) / max * 100));
  const delta = current != null && candidate != null ? Number(candidate) - Number(current) : null;
  const good = delta == null ? null : invert ? delta < 0 : delta > 0;
  return (
    <article className="compare-card">
      <div className="compare-head"><span>{label}</span>{delta != null && <b className={good ? "positive" : "negative"}>{delta > 0 ? "+" : ""}{delta.toFixed(1)}{suffix === "%" ? "%p" : suffix}</b>}</div>
      <div className="bar-line"><span>현재</span><div><i className="current-bar" style={{ width: `${curWidth}%` }} /></div><b>{metricValue(current, suffix)}</b></div>
      <div className="bar-line"><span>후보</span><div><i className="candidate-bar" style={{ width: `${candWidth}%` }} /></div><b>{metricValue(candidate, suffix)}</b></div>
    </article>
  );
}

function ChangeCompare({ current, candidate }) {
  return (
    <article className="compare-card change-card">
      <div className="compare-head"><span>상권변화지표</span><b>서울시 분류</b></div>
      <div className="change-pair"><div><small>현재</small><strong>{current?.change_index || "-"}</strong><p>{shortChange(current?.change_name)}</p></div><span>→</span><div className="candidate-change"><small>후보</small><strong>{candidate?.change_index || "-"}</strong><p>{shortChange(candidate?.change_name)}</p></div></div>
    </article>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return <label className="field"><span>{label}</span><input value={value} onChange={onChange} placeholder={placeholder} /></label>;
}
function MoneyField({ label, value, onChange, placeholder }) {
  return <label className="field"><span>{label}</span><div className="input-unit"><input inputMode="decimal" value={value} onChange={onChange} placeholder={placeholder} /><em>만원</em></div></label>;
}
function NumberField({ label, value, onChange, placeholder, suffix }) {
  return <label className="field"><span>{label}</span><div className="input-unit"><input inputMode="numeric" value={value} onChange={onChange} placeholder={placeholder} /><em>{suffix}</em></div></label>;
}
function TargetPeriodField({ label, value, onChange }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={onChange}><option value="12">12개월</option><option value="24">24개월</option><option value="36">36개월</option></select></label>;
}
function SelectField({ label, value, onChange, options }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={onChange}>{options.map((o) => <option key={o.industry_cd} value={o.industry_cd}>{o.industry_nm}</option>)}</select></label>;
}

function normalizePlace(raw, key, label) {
  return { ...raw, key, site_id: key, label };
}
function toMapPoint(place, label) {
  return { lat: Number(place.lat), lng: Number(place.lng), label, site_id: place.site_id, boundary: place.boundary, trdar_cd: place.trdar_cd, trdar_nm: place.trdar_nm };
}
function cleanError(text = "") {
  const raw = String(text || "");
  if (/Failed to fetch|NetworkError|Load failed|ERR_CONNECTION|ECONNREFUSED|fetch failed/i.test(raw)) {
    return "분석 서버 연결을 확인해주세요.";
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed.detail || raw;
  } catch {
    return raw.replace(/^Error:\s*/, "").slice(0, 180);
  }
}
function pct(v) { return Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(1)}%` : "-"; }
function formatWon(v) { return Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString("ko-KR") : "-"; }
function metricValue(v, suffix) { return v == null ? "-" : `${Number(v).toFixed(1)}${suffix}`; }
function periodText(p) { if (!p) return "기준시점 없음"; const s = String(p); return `${s.slice(0, 4)} Q${s.slice(-1)}`; }
function statusTone(status) {
  if (status === "접수 중") return "tone-live";
  if (status === "접수 예정") return "tone-soon";
  if (status === "오늘 마감" || status === "마감") return "tone-closed";
  return "tone-check";
}
function compactAddress(text) { return text.replace(/^서울(특별시)?\s*/, "").slice(0, 20); }
function shortChange(text) { if (!text) return "상권 전체 지표"; return String(text).replace(/\([^)]*\)/g, "").slice(0, 28); }

function buildNarrative(selected, candidateMetric, currentMetric, targetFocus, scenario95, comparisonMode) {
  const lines = [];
  if (comparisonMode === "STAY_VS_MOVE") lines.push("현재 매장을 유지할 수 있는 상황이므로 Stay와 선택한 후보 Move를 비교합니다.");
  if (comparisonMode === "MOVE_VS_MOVE") lines.push("현재 매장은 선택지가 아닌 기준점이며, 후보지끼리 동일한 손익 기준으로 비교합니다.");
  if (selected?.required_retention != null) lines.push(`후보 ${selected.site_id}에서 현재 월 운영이익을 유지하려면 현재 매출의 ${pct(selected.required_retention)}가 필요합니다.`);
  if (targetFocus) lines.push(`이전비를 ${targetFocus.months}개월 안에 회수하려면 월 ${formatWon(targetFocus.required_sales)}만원, 현재 매출의 ${pct(targetFocus.required_retention)}가 필요합니다.`);
  if (scenario95) lines.push(`현재 매출의 95%를 유지하는 시나리오에서는 ${scenario95.payback_months == null ? "이전비 회수가 어렵습니다" : `약 ${scenario95.payback_months}개월이 소요됩니다`}.`);
  const policyCount = selected?.policy_rag?.results?.length || 0;
  if (selected?.additional_fund_needed > 0) lines.push(`보유 가용현금을 반영하면 추가로 약 ${formatWon(selected.additional_fund_needed)}만원이 필요하며, 관련 정책금융 후보 ${policyCount}건을 함께 확인합니다.`);
  if (candidateMetric && currentMetric) {
    const salesPhrase = candidateMetric.sales_yoy != null && currentMetric.sales_yoy != null ? `동종업종 매출 YoY는 현재 ${currentMetric.sales_yoy.toFixed(1)}% → 후보 ${candidateMetric.sales_yoy.toFixed(1)}%` : null;
    const closurePhrase = candidateMetric.closure_rate != null && currentMetric.closure_rate != null ? `폐업률은 현재 ${currentMetric.closure_rate.toFixed(1)}% → 후보 ${candidateMetric.closure_rate.toFixed(1)}%` : null;
    if (salesPhrase || closurePhrase) lines.push(`${[salesPhrase, closurePhrase].filter(Boolean).join(", ")}입니다. 이는 개별 매장의 미래 매출 예측값이 아니라 상권 환경 비교 근거입니다.`);
  }
  return lines.length ? lines : ["계산된 경제성 조건과 서울시 상권 지표를 함께 비교하세요."];
}
