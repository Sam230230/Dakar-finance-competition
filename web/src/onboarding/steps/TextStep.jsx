import { useState } from "react";
import QuestionLayout from "../components/QuestionLayout.jsx";
import Prefill from "../components/Prefill.jsx";

export default function TextStep({ title, sub, value, placeholder, prefillScenario, onNext }) {
  const [val, setVal] = useState(value || "");

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
        <div className="input-line text">
          <input value={val} onChange={e => setVal(e.target.value)} placeholder={placeholder} />
        </div>
      </div>

      <div className="footer">
        <button className="next" disabled={val.trim() === ""} onClick={() => onNext(val.trim())}>
          다음
        </button>
      </div>
    </QuestionLayout>
  );
}
