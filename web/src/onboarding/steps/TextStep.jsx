import { useState } from "react";
import QuestionLayout from "../components/QuestionLayout.jsx";
import Prefill from "../components/Prefill.jsx";
import { useClearedError } from "../useClearedError.js";

/**
 * 한 줄 텍스트 질문.
 *
 * verify 를 넘기면 "다음"을 누를 때 그 함수로 값을 한 번 확인한다.
 * 다만 확인 결과로 진행을 막지는 않는다 — 서비스는 어떤 주소를 넣어도 결과를 내야 한다.
 * 대신 무엇이 부정확해지는지 한 번 보여주고, 같은 값으로 다시 누르면 그대로 넘어간다.
 * 알림을 보지도 못한 채 지나가면 알려줄 이유가 없고, 두 번 막으면 서비스가 아니다.
 */
export default function TextStep({ title, sub, value, placeholder, prefillScenario, verify, onNext }) {
  const [val, setVal] = useState(value || "");
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState("");
  // 이 알림이 어떤 값에 대한 것인지. 같은 값으로 다시 누르면 확인한 것으로 본다.
  const [noticedFor, setNoticedFor] = useState(null);
  const showError = useClearedError(val.trim() !== "");

  function edit(next) {
    setVal(next);
    if (notice) { setNotice(""); setNoticedFor(null); } // 고치기 시작하면 알림은 걷는다
  }

  async function submit() {
    const next = val.trim();
    if (next === "" || checking) return;
    if (!verify) {
      onNext(next);
      return;
    }
    if (noticedFor === next) { // 이미 보여준 값 — 사용자가 알고 누른 것이다
      onNext(next);
      return;
    }

    setChecking(true);
    const result = await verify(next);
    setChecking(false);

    if (!result.ok) { // 빈 주소처럼 진짜 진행할 수 없는 경우만
      setNotice(result.message);
      setNoticedFor(null);
      return;
    }
    if (result.message) {
      setNotice(result.message);
      setNoticedFor(next);
      return;
    }
    onNext(next);
  }

  const waiting = noticedFor === val.trim() && notice !== "";

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
        <div className={"input-line text" + (showError ? " error" : "")}>
          <input
            value={val}
            onChange={e => edit(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            placeholder={placeholder}
            aria-describedby={notice ? "address-notice" : undefined}
          />
        </div>
        {notice ? <p className="field-notice" id="address-notice" role="status">{notice}</p> : null}
      </div>

      <div className="footer">
        <button className="next" disabled={val.trim() === "" || checking} onClick={submit}>
          {checking ? "주소 확인 중…" : waiting ? "이대로 진행" : "다음"}
        </button>
      </div>
    </QuestionLayout>
  );
}
