import { useEffect, useState } from "react";

const LOADING_CORE = [
  "후보지 조건을 계산하고 있어요",
  "상권 ML 데이터를 확인하고 있어요",
  "후보별 정책금융을 찾고 있어요"
];
const LOADING_AI = "AI가 후보 간 차이를 해석하고 있어요";

export default function LoadingScreen({ stage }) {
  const [i, setI] = useState(0);
  // core 단계 문구를 한 번 빠르게 훑고, ai 단계로 넘어가면(실제 병목) 그 문구에서 멈춘다 —
  // 가짜 퍼센트 없이 지금 정말 무엇을 기다리는지만 보여준다.
  useEffect(() => {
    if (stage === "ai") return;
    const t = setInterval(() => setI(x => Math.min(x + 1, LOADING_CORE.length - 1)), 1400);
    return () => clearInterval(t);
  }, [stage]);

  const label = stage === "ai" ? LOADING_AI : LOADING_CORE[i];

  return (
    <main className="loading-page">
      <div className="spinner" />
      <h2>{label}</h2>
      <p>
        {stage === "ai"
          ? "AI 해석에는 10~20초 정도 걸릴 수 있어요. 결과는 해석까지 끝난 뒤 한 번에 보여드려요."
          : "잠시만 기다려주세요."}
      </p>
    </main>
  );
}
