import { monthly, lowerOrEqualCandidates, money, labels } from "../logic.js";

export default function BranchCheck({ data, onNext }) {
  const lower = lowerOrEqualCandidates(data);
  const cands = data.candidates.filter(c => (c.address || "").trim() !== "");

  return (
    <div className="single-col">
      <h1>
        후보지 비용을
        <br />
        현재 매장과 비교했어요.
      </h1>
      <p className="sub">후보별로 다음 질문과 결과에서 무엇을 먼저 볼지가 달라집니다.</p>

      <div className="content">
        <div className="summary">
          <div className="row">
            <span>현재 매장 월 고정비</span>
            <b>{money(data.current.fixed)}</b>
          </div>
          {cands.map((c, i) => (
            <div className="row" key={i}>
              <span>후보 {labels[i]} 월 운영비</span>
              <b>{money(monthly(c))}</b>
            </div>
          ))}
        </div>

        <div className="tip">
          {lower.length
            ? `현재보다 월 운영비가 낮거나 같은 후보가 ${lower.length}곳 있어요. 다음 단계에서 목표 회수기간을 한 번 더 여쭤볼게요.`
            : "모든 후보의 월 운영비가 현재보다 높아요. 회수기간은 묻지 않고 바로 분석할게요."}
        </div>
      </div>

      <div className="footer">
        <button className="next" onClick={() => onNext(lower.length > 0)}>
          계속
        </button>
      </div>
    </div>
  );
}
