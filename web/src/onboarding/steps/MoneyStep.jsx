import { useState } from "react";
import QuestionLayout from "../components/QuestionLayout.jsx";
import Prefill from "../components/Prefill.jsx";
import ChipRow from "../components/ChipRow.jsx";
import { useClearedError } from "../useClearedError.js";

export default function MoneyStep({ title, sub, value, chips, prefillScenario, onNext }) {
  const [val, setVal] = useState(value ?? "");
  const showError = useClearedError(val !== "");

  return (
    <QuestionLayout
      left={
        <>
          <h1 dangerouslySetInnerHTML={{ __html: title }} />
          <p className="sub">{sub}</p>
        </>
      }
    >
      <Prefill scenario={prefillScenario} />

      <div className="content">
        <div className={"input-line" + (showError ? " error" : "")}>
          <input type="number" min="0" value={val} onChange={e => setVal(e.target.value)} placeholder="0" />
          <span className="unit">만원</span>
        </div>
        <ChipRow options={chips} value={val} onSelect={setVal} />
      </div>

      <div className="footer">
        <button className="next" disabled={val === ""} onClick={() => onNext(Number(val))}>
          다음
        </button>
      </div>
    </QuestionLayout>
  );
}
