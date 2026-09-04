import { useState } from "react";
import QuestionLayout from "../components/QuestionLayout.jsx";
import Prefill from "../components/Prefill.jsx";
import { useClearedError } from "../useClearedError.js";

/**
 * 한 줄 텍스트 질문.
 *
 * verify 를 넘기면 "다음"을 누를 때 그 함수로 값을 한 번 검사하고, 통과할 때만 진행한다.
 * 주소처럼 형식은 맞지만 뒤에서 못 쓰는 값을 마지막 분석까지 끌고 가지 않기 위한 것이다.
 * verify 가 없으면 예전처럼 빈 값만 막는다.
 */
export default function TextStep({ title, sub, value, placeholder, prefillScenario, verify, onNext }) {
  const [val, setVal] = useState(value || "");
  const [checking, setChecking] = useState(false);
  const [reject, setReject] = useState("");
  const showError = useClearedError(val.trim() !== "");

  function edit(next) {
    setVal(next);
    if (reject) setReject(""); // 고치기 시작하면 지적은 걷는다
  }

  async function submit() {
    const next = val.trim();
    if (next === "" || checking) return;
    if (!verify) {
      onNext(next);
      return;
    }
    setChecking(true);
    const result = await verify(next);
    setChecking(false);
    if (!result.ok) {
      setReject(result.message);
      return;
    }
    onNext(next);
  }

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
        <div className={"input-line text" + (showError || reject ? " error" : "")}>
          <input
            value={val}
            onChange={e => edit(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            placeholder={placeholder}
            aria-invalid={reject ? "true" : undefined}
            aria-describedby={reject ? "address-reject" : undefined}
          />
        </div>
        {reject ? <p className="field-reject" id="address-reject" role="alert">{reject}</p> : null}
      </div>

      <div className="footer">
        <button className="next" disabled={val.trim() === "" || checking} onClick={submit}>
          {checking ? "주소 확인 중…" : "다음"}
        </button>
      </div>
    </QuestionLayout>
  );
}
