import { useEffect, useState } from "react";
import MapView from "./MapView";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";
const BADGE = { A: "#0071e3", B: "#a6791b", C: "#86868b" };
const DECISION_KO = { immediate: "즉시 이전 권장", conditional: "조건부 이전 권장", reconsider: "재검토 권고" };

// 백엔드 미연결 시 폴백 — /staymove 응답과 동일한 형태
const DEMO = {
  business_name: "아무개 커피", recommended: "B", decision: "immediate",
  current_operating_profit: 750, contribution_margin_rate: 0.6,
  ranking: [
    { site_id: "B", name: "망원동 주택가 코너 1층", score: 66, min_required_sales: 2450, required_retention: 0.875, initial_capital: 3900,
      scenarios: [{retention:1,monthly_gain:292,payback_months:15},{retention:0.95,monthly_gain:182,payback_months:24},{retention:0.9,monthly_gain:91,payback_months:48}] },
    { site_id: "C", name: "여의도 오피스가 지하1층", score: 35, min_required_sales: 2650, required_retention: 0.946, initial_capital: 3000, scenarios: [] },
    { site_id: "A", name: "성수동 카페거리 1층", score: 30, min_required_sales: 2800, required_retention: 1.0, initial_capital: 3500, scenarios: [] },
  ],
  explanation_markdown: "망원동(B)으로 이전을 권장합니다. 공헌이익률 60%를 적용하면 월 2,450만원만 유지해도 지금 벌던 750만원이 그대로 남습니다. 현재 매출의 87.5% 수준이라 충분히 도달 가능한 목표입니다.\n\n다만 매출이 90%로 떨어지면 회수가 48개월로 길어지니 초기 3개월 매출 방어가 관건입니다. 성수동(A)은 임대료가 수익성을 갉아먹어, 여의도(C)는 주말 공동화로 밀렸습니다.\n\n※ 매출 수치는 거래내역 기반 계산값, 상권 지표는 공개데이터 추정치입니다.",
  _demo: true,
};

const emptyCand = (id) => ({ site_id: id, name: "", monthly_rent: "", maintenance_fee: "", other_fixed_cost: "", deposit: "", interior_cost: "", moving_cost: "", closed_days: "" });

// 데모 입력값 (주소는 지오코딩 되는 실제 도로명)
const DEMO_INPUT = {
  cur: { business_name: "아무개 커피", current_site: "서울 관악구 관악로 145",
    monthly_sales: "2800", variable_cost: "1120", fixed_cost: "930", deposit: "2000" },
  cands: [
    { site_id: "A", name: "서울 성동구 성수이로 100", monthly_rent: "450", maintenance_fee: "30", other_fixed_cost: "450", deposit: "3000", interior_cost: "2500", moving_cost: "500", closed_days: "15" },
    { site_id: "B", name: "서울 마포구 망원로 50", monthly_rent: "250", maintenance_fee: "20", other_fixed_cost: "450", deposit: "3000", interior_cost: "2500", moving_cost: "500", closed_days: "15" },
    { site_id: "C", name: "서울 영등포구 여의대로 24", monthly_rent: "350", maintenance_fee: "40", other_fixed_cost: "450", deposit: "2500", interior_cost: "2000", moving_cost: "500", closed_days: "15" },
  ],
};

export default function App() {
  const [step, setStep] = useState("input");
  const [result, setResult] = useState(null);
  const [coords, setCoords] = useState(null);
  const [cur, setCur] = useState({ business_name: "", current_site: "", monthly_sales: "", variable_cost: "", fixed_cost: "", deposit: "" });
  const [cands, setCands] = useState([emptyCand("A"), emptyCand("B"), emptyCand("C")]);
  useThemeInit();

  const setCurF = (k) => (e) => setCur({ ...cur, [k]: e.target.value });
  const setCandF = (i, k) => (e) => { const n = [...cands]; n[i] = { ...n[i], [k]: e.target.value }; setCands(n); };
  const num = (v) => (v === "" || v == null ? 0 : Number(v));
  const fillDemo = () => { setCur({ ...DEMO_INPUT.cur }); setCands(DEMO_INPUT.cands.map((c) => ({ ...c }))); };

  async function submit(e) {
    e.preventDefault();
    setStep("loading");
    const payload = {
      business_name: cur.business_name || "우리 매장",
      current: { monthly_sales: num(cur.monthly_sales), variable_cost: num(cur.variable_cost), fixed_cost: num(cur.fixed_cost), deposit: num(cur.deposit) },
      candidates: cands.filter((c) => c.name.trim()).map((c) => ({
        site_id: c.site_id, name: c.name, monthly_rent: num(c.monthly_rent), maintenance_fee: num(c.maintenance_fee),
        other_fixed_cost: num(c.other_fixed_cost), deposit: num(c.deposit), interior_cost: num(c.interior_cost),
        moving_cost: num(c.moving_cost), closed_days: num(c.closed_days),
      })),
    };
    try {
      const res = await fetch(`${API_BASE}/staymove?explain=true`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      setResult(await res.json());
    } catch { setResult(DEMO); }

    // 지도용 좌표 (네이버 지오코딩) — 실패해도 결과는 표시
    try {
      const addrs = [cur.current_site, ...cands.filter((c) => c.name.trim()).map((c) => c.name)].filter(Boolean);
      const gr = await fetch(`${API_BASE}/geocode`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addresses: addrs }) });
      if (gr.ok) setCoords(await gr.json());
    } catch { setCoords(null); }

    setStep("result"); window.scrollTo({ top: 0 });
  }

  return (
    <>
      <header><div className="container nav">
        <div className="brand">Stay <span className="muted">or</span> Move</div>
        <div className="nav-right">
          {step === "result" && <button onClick={() => setStep("input")}>새 분석</button>}
          <ThemeToggle />
        </div>
      </div></header>
      <main>
        {step !== "result"
          ? <InputScreen {...{ cur, setCurF, cands, setCandF, submit, loading: step === "loading", fillDemo }} />
          : <ResultScreen data={result} coords={coords} currentAddr={cur.current_site} cands={cands} />}
      </main>
      <footer>Stay or Move · 매출은 거래내역 기반 계산값, 상권지표는 서울시·소진공 공개데이터(추정치) · © 서울열린데이터광장 / 소상공인시장진흥공단</footer>
    </>
  );
}

function InputScreen({ cur, setCurF, cands, setCandF, submit, loading, fillDemo }) {
  return (
    <>
      <section className="hero"><div className="container">
        <div className="eyebrow" style={{ marginBottom: 12 }}>Stay or Move</div>
        <h1>감이 아니라,<br /><span className="go">숫자로.</span></h1>
        <p className="sub">현재 매장 손익과 후보 3곳의 계약조건을 넣으면, 이전 시 최소 얼마를 팔아야 하는지 계산합니다.</p>
        <button type="button" className="pill" onClick={fillDemo}
          style={{ marginTop: 22, background: "transparent", color: "var(--accent)", border: "1px solid var(--accent)" }}>
          ⚡ 예시 데이터 한 번에 채우기
        </button>
      </div></section>

      <section className="alt" style={{ paddingTop: 56 }}>
        <form className="container" onSubmit={submit}>
          <div className="form-grid">
            <div className="form-col">
              <h3>현재 매장</h3><div className="step">STEP 1 · 지금의 손익 (단위: 만원)</div>
              <Field label="사업체명" v={cur.business_name} on={setCurF("business_name")} ph="예: 아무개 커피" req />
              <Field label="현재 사업지 주소" v={cur.current_site} on={setCurF("current_site")} ph="예: 서울 관악구 관악로 1" />
              <Num label="월평균 매출 (만원)" v={cur.monthly_sales} on={setCurF("monthly_sales")} ph="2800" req />
              <Num label="월평균 변동비 (재료비 등, 만원)" v={cur.variable_cost} on={setCurF("variable_cost")} ph="1120" req />
              <Num label="월평균 고정비 (임대료·인건비 등, 만원)" v={cur.fixed_cost} on={setCurF("fixed_cost")} ph="930" req />
              <Num label="현재 보증금 (만원)" v={cur.deposit} on={setCurF("deposit")} ph="2000" />
            </div>
            <div className="form-col">
              <h3>이전 후보지 3곳</h3><div className="step">STEP 2 · 후보 계약조건 (단위: 만원)</div>
              {cands.map((c, i) => (
                <div className="cand-input" key={c.site_id}>
                  <div className="badge" style={{ background: BADGE[c.site_id] }}>{c.site_id}</div>
                  <div style={{ flex: 1 }}>
                    <Field label="후보지 이름/주소" v={c.name} on={setCandF(i, "name")} ph="예: 서울 마포구 망원로 10" />
                    <div className="num-row">
                      <Num label="월세" v={c.monthly_rent} on={setCandF(i, "monthly_rent")} ph="250" small />
                      <Num label="관리비" v={c.maintenance_fee} on={setCandF(i, "maintenance_fee")} ph="20" small />
                      <Num label="기타고정비" v={c.other_fixed_cost} on={setCandF(i, "other_fixed_cost")} ph="450" small />
                    </div>
                    <div className="num-row">
                      <Num label="보증금" v={c.deposit} on={setCandF(i, "deposit")} ph="3000" small />
                      <Num label="인테리어" v={c.interior_cost} on={setCandF(i, "interior_cost")} ph="2500" small />
                      <Num label="이사·철거" v={c.moving_cost} on={setCandF(i, "moving_cost")} ph="500" small />
                    </div>
                    <Num label="예상 휴업일수 (일)" v={c.closed_days} on={setCandF(i, "closed_days")} ph="15" small />
                  </div>
                </div>
              ))}
              <button className="pill" style={{ width: "100%", marginTop: 18, padding: 14 }} disabled={loading}>
                {loading ? "계산 중… (AI 설명까지 수십 초)" : "이전지 추천 받기 →"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </>
  );
}

function ResultScreen({ data, coords, currentAddr, cands }) {
  const ranking = data.ranking || [];
  const rec = ranking.find((c) => c.site_id === data.recommended) || ranking[0] || {};
  const recShort = (rec.name || "").split(" ").slice(-1)[0].replace(/\d.*$/, "") || rec.name || "추천지";
  const won = (n) => (n == null ? "-" : Number(n).toLocaleString());
  const retPct = rec.required_retention != null ? (rec.required_retention * 100).toFixed(1) : "-";

  // 지도 좌표 매핑: coords[0]=현재, 이후 후보 순서(입력 순)
  const named = cands.filter((c) => c.name.trim());
  let mapCur = null, mapCands = [];
  if (coords && coords.length) {
    const cur0 = coords.find((p) => p.address === currentAddr);
    if (cur0 && cur0.matched) mapCur = { lat: cur0.lat, lng: cur0.lng, label: data.business_name };
    mapCands = named.map((c) => {
      const p = coords.find((x) => x.address === c.name);
      return p && p.matched ? { site_id: c.site_id, lat: p.lat, lng: p.lng, label: c.name } : null;
    }).filter(Boolean);
  }
  const hasMap = mapCands.length > 0;

  return (
    <>
      <section className="hero"><div className="container">
        <div className="eyebrow" style={{ marginBottom: 12 }}>{data.business_name} · 이전 의사결정{data._demo ? " (데모)" : ""}</div>
        <h1>{recShort}으로<br /><span className="go">{data.decision === "reconsider" ? "신중히." : "옮기세요."}</span></h1>
        <p className="sub">감이 아니라, 숫자가 그렇게 말합니다.</p>
        <div className="verdict-pill">✓ {DECISION_KO[data.decision] || data.decision} · 후보 {data.recommended}</div>
      </div></section>

      <section className="alt"><div className="container">
        <div className="sec-head"><h2>이전해도 될까요?<br />숫자가 먼저 답합니다.</h2>
          <p>현재 매장의 월 수익 {won(data.current_operating_profit)}만원을 지키기 위한 기준입니다.</p></div>
        <div className="figures">
          <Fig n={won(rec.min_required_sales)} unit="만원" gold cap="최소 필요 월매출" note="현재 수익 유지 손익분기" />
          <Fig n={retPct} unit="%" cap="필요 매출 유지율" note="현재 매출 대비" />
          <Fig n={won(rec.initial_capital)} unit="만원" cap="초기 이전 자금" note="인테리어·이사·휴업 + 추가보증금" />
        </div>
      </div></section>

      {hasMap && (
        <section><div className="container">
          <div className="sec-head"><h2>추천 입지, 한눈에.</h2><p>추천지 중심 반경 300·500m를 함께 봤습니다.</p></div>
          <div className="map"><MapView current={mapCur} candidates={mapCands} recommendedId={data.recommended} radii={[300, 500]} /></div>
        </div></section>
      )}

      <section className={hasMap ? "alt" : ""}><div className="narrow">
        <div className="sec-head"><h2>얼마나 팔면,<br />언제 본전일까.</h2><p>추천지({data.recommended}) 매출 유지율별 회수기간.</p></div>
        <table className="stable tnum"><thead><tr><th>이전 후 매출</th><th>월 개선액</th><th>회수기간</th></tr></thead>
          <tbody>{(rec.scenarios || []).map((s, i) => (
            <tr key={i} className={s.retention === 1 ? "best" : ""}>
              <td>현재 {Math.round(s.retention * 100)}% 유지</td>
              <td>{s.monthly_gain == null ? "-" : (s.monthly_gain >= 0 ? "+" : "") + won(s.monthly_gain) + "만"}</td>
              <td style={s.payback_months == null ? { color: "var(--neg)" } : {}}>{s.payback_months == null ? "회수 어려움" : s.payback_months + "개월"}</td>
            </tr>))}
          </tbody></table>
      </div></section>

      <section className={hasMap ? "" : "alt"}><div className="container">
        <div className="sec-head"><h2>세 곳을 같은 잣대로.</h2><p>경제성(필요 유지율·회수기간) 기반 종합 점수.</p></div>
        <div className="cands">{ranking.map((c) => (
          <div key={c.site_id} className={"cand" + (c.site_id === data.recommended ? " win" : "")}>
            <div className="crown">{c.site_id === data.recommended ? "👑" : ""}</div>
            <div className="cid">{c.site_id}</div><div className="cname">{c.name}</div>
            <div className="score tnum">{c.score}<small>/100</small></div>
            <div className="rows">
              <div className="r"><span>최소 필요매출</span><b>{won(c.min_required_sales)}만</b></div>
              <div className="r"><span>필요 유지율</span><b>{(c.required_retention * 100).toFixed(1)}%</b></div>
              <div className="r"><span>초기 이전자금</span><b>{won(c.initial_capital)}만</b></div>
            </div>
          </div>))}
        </div>
      </div></section>

      <section className="alt"><div className="narrow">
        <div className="sec-head"><div className="eyebrow" style={{ marginBottom: 10 }}>AI 컨설턴트</div><h2>왜 {recShort}일까요.</h2></div>
        <div className="ai">
          {String(data.explanation_markdown || "").split(/\n\n+/).map((p, i) => <p key={i}>{cleanMd(p)}</p>)}
        </div>
      </div></section>
    </>
  );
}

// 아주 가벼운 마크다운 정리(안전하게 텍스트로만)
const cleanMd = (s) => s.replace(/[*#`>]/g, "").replace(/^\s*[-•]\s?/gm, "· ").trim();

const Field = ({ label, v, on, ph, req }) => (
  <label className="field"><span>{label}</span><input className="input" value={v} onChange={on} placeholder={ph} required={req} /></label>
);
const Num = ({ label, v, on, ph, req, small }) => (
  <label className="field" style={small ? { marginBottom: 10 } : {}}><span>{label}</span>
    <input className="input" type="number" inputMode="numeric" value={v} onChange={on} placeholder={ph} required={req} /></label>
);
const Fig = ({ n, unit, cap, note, gold }) => (
  <div className="figure"><div className={"n tnum" + (gold ? " gold" : "")}>{n}<small> {unit}</small></div>
    <div className="cap">{cap}</div><div className="note">{note}</div></div>
);

function useThemeInit() { useEffect(() => {
  try { const s = localStorage.getItem("sm-theme"); if (s && s !== "system") document.documentElement.setAttribute("data-theme", s); } catch {}
}, []); }
function ThemeToggle() {
  const [t, setT] = useState("system");
  const order = { system: "light", light: "dark", dark: "system" }, icon = { system: "◐", light: "☀", dark: "☾" };
  useEffect(() => { try { setT(localStorage.getItem("sm-theme") || "system"); } catch {} }, []);
  const click = () => {
    const next = order[t];
    if (next === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("sm-theme", next); } catch {}
    setT(next);
  };
  return <button onClick={click} aria-label="테마 전환">{icon[t]}</button>;
}
