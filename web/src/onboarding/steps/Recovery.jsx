import { useState } from "react";
import QuestionLayout from "../components/QuestionLayout.jsx";

const SHORTCUTS = [12, 24, 36];

export default function Recovery({ initialMonths, onNext }) {
  const [months, setMonths] = useState(initialMonths || 24);
  const percent = ((months - 1) / (36 - 1)) * 100;

  return (
    <QuestionLayout
      left={
        <>
          <h1>
            이전비용을 몇 개월 안에
            <br />
            회수하고 싶어요?
          </h1>
          <p className="sub">1개월부터 36개월까지 원하는 기간을 직접 조절해보세요.</p>
        </>
      }
    >
      <div className="content">
        <div className="slider-wrap">
          <div className="slider-value">
            <strong>{months}</strong>
            <span>개월</span>
          </div>

          <input
            className="range"
            type="range"
            min="1"
            max="36"
            step="1"
            value={months}
            style={{ "--range-progress": `${percent}%` }}
            onChange={e => setMonths(Number(e.target.value))}
            aria-label="목표 회수기간"
          />

          <div className="range-labels">
            <span>1개월</span>
            <span>12개월</span>
            <span>24개월</span>
            <span>36개월</span>
          </div>

          <div className="range-shortcuts">
            {SHORTCUTS.map(v => (
              <button
                key={v}
                type="button"
                className={"range-shortcut" + (months === v ? " active" : "")}
                onClick={() => setMonths(v)}
              >
                {v}개월
              </button>
            ))}
          </div>
        </div>

        <div className="recovery-card">
          <b>선택한 기간에 맞춰 필요매출을 계산합니다.</b>
          <p>기간이 짧을수록 매달 회수해야 하는 금액이 커져 목표 필요매출도 높아집니다.</p>
        </div>
      </div>

      <div className="footer">
        <button className="next" onClick={() => onNext(months)}>
          이 기간으로 계산하기
        </button>
      </div>
    </QuestionLayout>
  );
}
