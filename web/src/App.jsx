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
  closed_days: "",
});

const DEMO_INPUT = {
  cur: {
    business_name: "스테이 커피",
    current_site: "서울 마포구 양화로 33",
    monthly_sales: "2800",
    variable_cost: "1120",
    fixed_cost: "930",
    deposit: "2000",
  },
  cands: [
    { site_id: "A", name: "서울 마포구 망원로 50", monthly_rent: "250", maintenance_fee: "20", other_fixed_cost: "450", deposit: "3000", interior_cost: "2500", moving_cost: "500", closed_days: "15" },
    { site_id: "B", name: "서울 마포구 월드컵로13길 18", monthly_rent: "220", maintenance_fee: "15", other_fixed_cost: "410", deposit: "2500", interior_cost: "1700", moving_cost: "450", closed_days: "10" },
    { site_id: "C", name: "서울 마포구 동교로 162", monthly_rent: "310", maintenance_fee: "25", other_fixed_cost: "460", deposit: "3500", interior_cost: "2100", moving_cost: "500", closed_days: "12" },
  ],
};

export default function App() {
  const [screen, setScreen] = useState("input");
  const [result, setResult] = useState(null);
  const [marketRows, setMarketRows] = useState([]);
  const [industryCode, setIndustryCode] = useState("CS100010");
  const [industries, setIndustries] = useState([{ industry_cd: "CS100010", industry_nm: "커피-음료" }]);
  const [cur, setCur] = useState({ business_name: "", current_site: "", monthly_sales: "", variable_cost: "", fixed_cost: "", deposit: "" });
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
    if (num(cur.monthly_sales) <= 0) return setNotice("월평균 매출을 입력해주세요.");

    setScreen("loading");
    const payload = {
      business_name: cur.business_name || "우리 매장",
      current: {
        monthly_sales: num(cur.monthly_sales),
        variable_cost: num(cur.variable_cost),
        fixed_cost: num(cur.fixed_cost),
        deposit: num(cur.deposit),
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
        closed_days: num(c.closed_days),
      })),
    };

    try {
      const [analysis, resolved] = await Promise.all([
        fetch(`${API_BASE}/staymove?explain=${DEMO_MODE ? "false" : "true"}`, {
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
    setScreen("input");
    setResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="app-shell">
      <TopBar onHome={reset} onDemo={fillDemo} demoMode={DEMO_MODE} result={screen === "result"} />
      {notice && <div className="toast-line" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>닫기</button></div>}
      {screen === "result" ? (
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
          onSubmit={submit}
        />
      )}
    </div>
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

function InputScreen({ cur, cands, places, industries, industryCode, activeSite, searching, loading, currentMap, candidateMaps, onCurrent, onCandidate, onIndustry, onActiveSite, onSearch, onMapClick, onDemo, onSubmit }) {
  const activeCandIndex = Math.max(0, cands.findIndex((c) => c.site_id === activeSite));
  const contractSite = activeSite === "current" ? "A" : activeSite;
  const contractIndex = Math.max(0, cands.findIndex((c) => c.site_id === contractSite));
  const activeContract = cands[contractIndex];

  return (
    <main>
      <section className="hero page-width">
        <h1>Stay or Move</h1>
        <div className="hero-meta">
          <span>서울시 상권 데이터</span><span>+</span><span>NAVER Maps</span><span>+</span><span>사업자 손익</span>
        </div>
      </section>

      <form onSubmit={onSubmit}>
        <section className="map-workspace page-width">
          <div className="search-rail">
            <div className="rail-head">
              <div><span className="eyebrow">01</span><h2>매장 위치</h2></div>
              <button type="button" className="micro-button" onClick={onDemo}>데모</button>
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
                optional={c.site_id !== "A"}
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
              <h2>현재 매장</h2>
              <p>현재 가게의 월 손익을 기준점으로 사용합니다.</p>
            </div>
            <div className="form-card">
              <div className="form-grid">
                <TextField label="사업체명" value={cur.business_name} onChange={onCurrent("business_name")} placeholder="예: 스테이 커피" />
                <SelectField label="업종" value={industryCode} onChange={(e) => onIndustry(e.target.value)} options={industries} />
                <MoneyField label="월평균 매출" value={cur.monthly_sales} onChange={onCurrent("monthly_sales")} placeholder="2,800" />
                <MoneyField label="월평균 변동비" value={cur.variable_cost} onChange={onCurrent("variable_cost")} placeholder="1,120" />
                <MoneyField label="월평균 고정비" value={cur.fixed_cost} onChange={onCurrent("fixed_cost")} placeholder="930" />
                <MoneyField label="현재 보증금" value={cur.deposit} onChange={onCurrent("deposit")} placeholder="2,000" />
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
                  <small>{c.name ? compactAddress(c.name) : c.site_id === "A" ? "필수" : "선택"}</small>
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
              <MoneyField label="이사·철거비" value={activeContract.moving_cost} onChange={onCandidate(contractIndex, "moving_cost")} placeholder="500" />
              <NumberField label="예상 휴업일수" value={activeContract.closed_days} onChange={onCandidate(contractIndex, "closed_days")} placeholder="15" suffix="일" />
            </div>
          </div>
          <div className="analysis-action">
            <div><span>서울시 데이터는 로컬 DB에서 조회합니다.</span><small>OpenAI 키 없이도 데모 분석 가능</small></div>
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
  const target24 = (selected.target_periods || []).find((x) => x.months === 24);
  const scenario95 = (selected.scenarios || []).find((x) => Math.round(x.retention * 100) === 95);

  const narrative = buildNarrative(selected, candidateMetric, currentMetric, target24, scenario95);

  return (
    <main className="result-page">
      <section className="result-hero page-width">
        <div><span className="eyebrow">RESULT</span><h1>Stay or Move</h1></div>
        <div className="result-switch">
          {analyses.map((c) => <button type="button" key={c.site_id} className={selectedId === c.site_id ? "active" : ""} onClick={() => setSelectedId(c.site_id)}><i style={{ background: SITE_META[c.site_id].color }} />후보 {c.site_id}</button>)}
        </div>
      </section>

      <section className="page-width kpi-ribbon">
        <KpiCard index="01" label="필요 매출 유지율" value={pct(selected.required_retention)} sub={`최소 월 ${formatWon(selected.min_required_sales)}만원`} emphasis />
        <KpiCard index="02" label="24개월 회수 목표" value={target24 ? pct(target24.required_retention) : "-"} sub={target24 ? `월 ${formatWon(target24.required_sales)}만원` : "-"} />
        <KpiCard index="03" label="매출 95% 유지 시" value={scenario95?.payback_months ? `${scenario95.payback_months}개월` : "회수 어려움"} sub="실제 이전비 기준" />
        <KpiCard index="04" label="초기 이전 소요자금" value={`${formatWon(selected.initial_capital)}만`} sub={`소모비 ${formatWon(selected.actual_relocation_cost)}만`} />
      </section>

      <section className="page-width result-map-section">
        <div className="map-frame result-map-frame">
          <MapView current={current} candidates={candidates} selectedId={selectedId} activeKey={selectedId} showBoundaries />
          <div className="map-top-chip">CURRENT ↔ {selectedId}</div>
        </div>
        <aside className="result-place-card">
          <span className="eyebrow">LOCATION</span>
          <div className="place-badge" style={{ background: SITE_META[selectedId].color }}>{selectedId}</div>
          <h2>{places[selectedId]?.trdar_nm || `후보 ${selectedId}`}</h2>
          <p>{places[selectedId]?.road_address || selected.name}</p>
          <dl>
            <div><dt>상권코드</dt><dd>{places[selectedId]?.trdar_cd || "-"}</dd></div>
            <div><dt>현재 상권</dt><dd>{places.current?.trdar_nm || "-"}</dd></div>
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
  try { const parsed = JSON.parse(text); return parsed.detail || text; } catch { return String(text).replace(/^Error:\s*/, "").slice(0, 180); }
}
function pct(v) { return Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(1)}%` : "-"; }
function formatWon(v) { return Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString("ko-KR") : "-"; }
function metricValue(v, suffix) { return v == null ? "-" : `${Number(v).toFixed(1)}${suffix}`; }
function periodText(p) { if (!p) return "기준시점 없음"; const s = String(p); return `${s.slice(0, 4)} Q${s.slice(-1)}`; }
function compactAddress(text) { return text.replace(/^서울(특별시)?\s*/, "").slice(0, 20); }
function shortChange(text) { if (!text) return "상권 전체 지표"; return String(text).replace(/\([^)]*\)/g, "").slice(0, 28); }

function buildNarrative(selected, candidateMetric, currentMetric, target24, scenario95) {
  const lines = [];
  if (selected?.required_retention != null) lines.push(`후보 ${selected.site_id}에서 현재 월 운영이익을 유지하려면 현재 매출의 ${pct(selected.required_retention)}가 필요합니다.`);
  if (target24) lines.push(`이전비를 24개월 안에 회수하려면 월 ${formatWon(target24.required_sales)}만원, 현재 매출의 ${pct(target24.required_retention)}가 필요합니다.`);
  if (scenario95) lines.push(`현재 매출의 95%를 유지하는 시나리오에서는 ${scenario95.payback_months == null ? "이전비 회수가 어렵습니다" : `약 ${scenario95.payback_months}개월이 소요됩니다`}.`);
  if (candidateMetric && currentMetric) {
    const salesPhrase = candidateMetric.sales_yoy != null && currentMetric.sales_yoy != null ? `동종업종 매출 YoY는 현재 ${currentMetric.sales_yoy.toFixed(1)}% → 후보 ${candidateMetric.sales_yoy.toFixed(1)}%` : null;
    const closurePhrase = candidateMetric.closure_rate != null && currentMetric.closure_rate != null ? `폐업률은 현재 ${currentMetric.closure_rate.toFixed(1)}% → 후보 ${candidateMetric.closure_rate.toFixed(1)}%` : null;
    if (salesPhrase || closurePhrase) lines.push(`${[salesPhrase, closurePhrase].filter(Boolean).join(", ")}입니다. 이는 개별 매장의 미래 매출 예측값이 아니라 상권 환경 비교 근거입니다.`);
  }
  return lines.length ? lines : ["계산된 경제성 조건과 서울시 상권 지표를 함께 비교하세요."];
}
