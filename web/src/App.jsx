import { useEffect, useState } from "react";
import ResultScreen from "./ResultScreen";
import LiveSummaryPanel from "./onboarding/components/LiveSummaryPanel.jsx";
import Start from "./onboarding/steps/Start.jsx";
import TextStep from "./onboarding/steps/TextStep.jsx";
import MoneyStep from "./onboarding/steps/MoneyStep.jsx";
import FixedStep from "./onboarding/steps/FixedStep.jsx";
import CashStep from "./onboarding/steps/CashStep.jsx";
import CandidatesStep from "./onboarding/steps/CandidatesStep.jsx";
import BranchCheck from "./onboarding/steps/BranchCheck.jsx";
import Recovery from "./onboarding/steps/Recovery.jsx";
import LoadingScreen from "./onboarding/steps/LoadingScreen.jsx";
import { blankState, scenario, labels, toStayMovePayload } from "./onboarding/logic.js";
import "./styles.css";
import "./onboarding/onboarding.css";
import "./result/result.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";

const STEP_META = {
  start: { cur: 0, label: "시작" },
  currentAddress: { cur: 1 },
  sales: { cur: 2 },
  variable: { cur: 3 },
  fixed: { cur: 4 },
  cash: { cur: 5 },
  candidates: { cur: 6 },
  branchCheck: { cur: 7, label: "분석" },
  recovery: { cur: 7, label: "추가" }
};

const TOTAL_STEPS = 7;

export default function App() {
  const [data, setData] = useState(() => blankState());
  const [history, setHistory] = useState([{ step: "start", payload: {} }]);
  const cur = history[history.length - 1];

  // 백엔드 연동 상태
  const [phase, setPhase] = useState("onboarding"); // onboarding | loading | result
  const [loadingStage, setLoadingStage] = useState("core");
  const [result, setResult] = useState(null);
  const [places, setPlaces] = useState({ current: null, A: null, B: null, C: null });
  const [aiState, setAiState] = useState("idle");
  const [error, setError] = useState("");

  function push(step, payload = {}) {
    setHistory(h => [...h, { step, payload }]);
  }
  // 프리뷰 체크리스트에서 이미 답한 단계를 눌러 그 단계로 바로 돌아가기.
  // 이전 버튼을 없앴으므로 되돌아가는 경로는 이것 하나다(시작 화면 포함).
  // 해당 단계가 처음 등장한 지점까지 히스토리를 되감으므로, 뒤 단계 입력값은
  // state에 그대로 남아 다시 진행할 때 프리필로 재사용된다.
  function goToStep(targetCur) {
    setHistory(h => {
      const idx = h.findIndex(x => (STEP_META[x.step]?.cur ?? -1) === targetCur);
      return idx === -1 ? h : h.slice(0, idx + 1);
    });
  }
  function resetAll() {
    setHistory([{ step: "start", payload: {} }]);
    setData(blankState());
    setResult(null);
    setPlaces({ current: null, A: null, B: null, C: null });
    setAiState("idle");
    setError("");
    setPhase("onboarding");
  }
  // 시작 화면을 히스토리에 남겨야 1단계에서 뒤로가기로 시나리오를 다시 고를 수 있다
  function startScenario(n) {
    setData(scenario(n));
    setHistory([{ step: "start", payload: {} }, { step: "currentAddress", payload: {} }]);
  }
  function startBlank() {
    setData(blankState());
    setHistory([{ step: "start", payload: {} }, { step: "currentAddress", payload: {} }]);
  }

  // 주소 → 좌표·상권코드. 한 주소가 실패해도 Rule/ML/RAG 전체를 막지 않는다.
  async function resolvePlace(key, address) {
    if (!address?.trim()) return null;
    try {
      const r = await fetch(`${API_BASE}/commercial-area`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim() })
      });
      if (!r.ok) return null;
      const raw = await r.json();
      return {
        site_id: key,
        label: key === "current" ? "현재 매장" : `후보 ${key}`,
        lat: raw.lat,
        lng: raw.lng,
        trdar_cd: raw.trdar_cd,
        trdar_nm: raw.trdar_nm,
        boundary: raw.boundary
      };
    } catch {
      return null;
    }
  }

  async function analyze(recoveryMonths) {
    setPhase("loading");
    setLoadingStage("core");
    setError("");

    const cands = data.candidates.filter(c => (c.address || "").trim() !== "");

    try {
      // 주소 변환은 서로 독립적이므로 동시에 요청한다.
      const resolved = await Promise.all([
        resolvePlace("current", data.current.address),
        ...cands.map((c, i) => resolvePlace(labels[i], c.address))
      ]);
      const nextPlaces = { current: resolved[0], A: null, B: null, C: null };
      cands.forEach((_, i) => {
        nextPlaces[labels[i]] = resolved[i + 1];
      });
      setPlaces(nextPlaces);

      const trdarByIndex = {};
      cands.forEach((_, i) => {
        trdarByIndex[i] = resolved[i + 1]?.trdar_cd || null;
      });

      const payload = toStayMovePayload(data, { candidates: cands, recoveryMonths, trdarByIndex });

      // 1단계: Rule + ML + 후보별 RAG만 계산(수백 ms) — 서버는 이 결과를 analysis_id로
      // 잠시 캐시해둔다. 화면 전환은 아직 하지 않고, AI 해석까지 끝난 결과를 한 번에 보여준다.
      const r = await fetch(`${API_BASE}/staymove?explain=false&use_rag=true&use_ml=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error(await r.text());
      const core = await r.json();
      setLoadingStage("ai");

      // 2단계: AI 설명. 코어 계산값을 다시 보내는 대신 서버가 analysis_id로 캐시해둔 값을
      // 그대로 써서 프롬프트 인젝션 여지를 막는다. 실패해도 계산·검색 결과만으로 보여준다.
      let finalResult = core;
      let nextAiState = "done";
      try {
        const er = await fetch(`${API_BASE}/staymove/explain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analysis_id: core.analysis_id })
        });
        if (!er.ok) throw new Error(await er.text());
        const explain = await er.json();
        const bySite = Object.fromEntries(explain.candidates.map(c => [c.site_id, c.ai_explanation]));
        finalResult = {
          ...core,
          candidates: core.candidates.map(c => ({ ...c, ai_explanation: bySite[c.site_id] || c.ai_explanation })),
          comparison_summary: explain.comparison_summary,
          overall: explain.overall,
          performance: { ...core.performance, ...explain.performance }
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
      setPhase("onboarding");
    } finally {
      setLoadingStage("core");
    }
  }

  useEffect(() => {
    if (phase === "onboarding" && error) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [phase, error]);

  if (phase === "loading") return <LoadingScreen stage={loadingStage} />;
  if (phase === "result") {
    return <ResultScreen data={result} places={places} aiState={aiState} onRestart={resetAll} />;
  }

  const meta = STEP_META[cur.step] || {};
  const stepKey = cur.step + JSON.stringify(cur.payload);

  // 시작(시나리오 선택) 화면은 아직 정리해서 보여줄 데이터가 없어 단일 컬럼을 쓰되,
  // 상단 진행바는 다른 단계와 같은 전체폭 형식으로 맞춘다
  if (cur.step === "start") {
    return (
      <>
        <div className="top-progress" role="progressbar" aria-valuenow={0} aria-valuemin={0} aria-valuemax={TOTAL_STEPS}>
          <div className="top-progress-bar" style={{ width: "0%" }} />
        </div>
        <main className="page">
          <div className="screen step-enter" key={stepKey}>
            <Start onScenario={startScenario} onBlank={startBlank} />
          </div>
        </main>
      </>
    );
  }

  const stepCur = meta.cur ?? 1;

  return (
    <>
      {/* 화면 전체 폭을 쓰는 진행바 — 좌우 어느 쪽을 보고 있어도 진행도가 보이도록 */}
      <div className="top-progress" role="progressbar" aria-valuenow={stepCur} aria-valuemin={0} aria-valuemax={TOTAL_STEPS}>
        <div className="top-progress-bar" style={{ width: `${Math.max(4, (stepCur / TOTAL_STEPS) * 100)}%` }} />
      </div>

      <div className="app-split">
        <LiveSummaryPanel
          data={data}
          cur={stepCur}
          onJump={goToStep}
        />
        <main className="stage">
          <div className="stage-inner screen step-enter" key={stepKey}>
            {error ? <div className="onboarding-error">{error}</div> : null}
            {renderStep()}
          </div>
        </main>
      </div>
    </>
  );

  function renderStep() {
    switch (cur.step) {
      case "currentAddress":
        return (
          <TextStep
            title="운영 중인 카페 위치를<br/>알려주세요."
            sub="주소를 기준으로 현재 상권 데이터를 연결합니다."
            value={data.current.address}
            placeholder="예: 서울 마포구 연남동"
            prefillScenario={data.demoScenario}
            onNext={v => {
              setData(d => ({ ...d, current: { ...d.current, address: v } }));
              push("sales");
            }}
          />
        );

      case "sales":
        return (
          <MoneyStep
            title="월평균 매출을<br/>입력해 주세요."
            sub="최근 3개월 평균 기준"
            value={data.current.sales}
            chips={[2000, 2800, 3500, 4500]}
            prefillScenario={data.demoScenario}
            onNext={v => {
              setData(d => ({ ...d, current: { ...d.current, sales: v } }));
              push("variable");
            }}
          />
        );

      case "variable":
        return (
          <MoneyStep
            title="월 변동비를<br/>입력해 주세요."
            sub="재료비, 수수료 등 매출에 연동되는 비용 기준"
            value={data.current.variable}
            chips={[600, 900, 1200, 1500]}
            prefillScenario={data.demoScenario}
            onNext={v => {
              setData(d => ({ ...d, current: { ...d.current, variable: v } }));
              push("fixed");
            }}
          />
        );

      case "fixed":
        return (
          <FixedStep
            current={data.current}
            prefillScenario={data.demoScenario}
            onNext={({ rent, labor, mgmt, fixed }) => {
              setData(d => ({ ...d, current: { ...d.current, rent, labor, mgmt, fixed } }));
              push("cash");
            }}
          />
        );

      case "cash":
        return (
          <CashStep
            current={data.current}
            prefillScenario={data.demoScenario}
            onNext={patch => {
              setData(d => ({ ...d, current: { ...d.current, ...patch } }));
              push("candidates");
            }}
          />
        );

      case "candidates":
        return (
          <CandidatesStep
            candidates={data.candidates}
            prefillScenario={data.demoScenario}
            onNext={list => {
              setData(d => ({ ...d, candidateCount: list.length, candidates: list }));
              push("branchCheck");
            }}
          />
        );

      case "branchCheck":
        return <BranchCheck data={data} onNext={hasLower => (hasLower ? push("recovery") : analyze(null))} />;

      case "recovery":
        return (
          <Recovery
            initialMonths={data.recoveryMonths || 24}
            onNext={months => {
              setData(d => ({ ...d, recoveryMonths: months }));
              analyze(months);
            }}
          />
        );

      default:
        return null;
    }
  }
}

function cleanError(text = "") {
  try {
    const parsed = JSON.parse(text);
    return parsed.detail || text;
  } catch {
    return String(text).slice(0, 240);
  }
}
