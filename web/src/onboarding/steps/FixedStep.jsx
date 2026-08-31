import { useState } from "react";
import QuestionLayout from "../components/QuestionLayout.jsx";
import Prefill from "../components/Prefill.jsx";
import ChipRow from "../components/ChipRow.jsx";
import { money } from "../logic.js";

export default function FixedStep({ current, prefillScenario, onNext }) {
  const [rent, setRent] = useState(current.rent ?? "");
  const [labor, setLabor] = useState(current.labor ?? "");
  const [mgmt, setMgmt] = useState(current.mgmt ?? "");

  const total = (Number(rent) || 0) + (Number(labor) || 0) + (Number(mgmt) || 0);
  // 다른 단계와 같은 규칙: 세 칸이 모두 채워져야 다음으로.
  // 인건비가 없는 매장은 0을 넣으면 되도록 칩에 0만원을 두었다.
  const ready = rent !== "" && labor !== "" && mgmt !== "";

  return (
    <QuestionLayout
      left={
        <>
          <h1>
            월 고정비를
            <br />
            항목별로 입력해 주세요.
          </h1>
          <p className="sub">월세, 고정 인건비, 관리비를 더한 금액이에요.</p>
        </>
      }
    >
      <Prefill scenario={prefillScenario} />

      <div className="content">
        <div className="field-block">
          <div className="field-block-head">
            <span className="field-block-label">월세</span>
          </div>
          <div className="input-line">
            <input type="number" min="0" value={rent} onChange={e => setRent(e.target.value)} placeholder="0" />
            <span className="unit">만원</span>
          </div>
          <ChipRow options={[100, 150, 200, 300]} value={rent} onSelect={setRent} />
        </div>

        <div className="field-block">
          <div className="field-block-head">
            <span className="field-block-label">고정 인건비</span>
          </div>
          <div className="input-line">
            <input type="number" min="0" value={labor} onChange={e => setLabor(e.target.value)} placeholder="0" />
            <span className="unit">만원</span>
          </div>
          <ChipRow options={[0, 150, 300, 500]} value={labor} onSelect={setLabor} />
        </div>

        <div className="field-block">
          <div className="field-block-head">
            <span className="field-block-label">관리비</span>
          </div>
          <div className="input-line">
            <input type="number" min="0" value={mgmt} onChange={e => setMgmt(e.target.value)} placeholder="0" />
            <span className="unit">만원</span>
          </div>
          <ChipRow options={[10, 30, 50, 80]} value={mgmt} onSelect={setMgmt} />
        </div>

        <div className="sum-box">
          <span className="sum-label">총 고정비</span>
          <span className="sum-value">{money(total)}</span>
        </div>
      </div>

      <div className="footer">
        <button
          className="next"
          disabled={!ready}
          onClick={() => {
            const r = Number(rent || 0), l = Number(labor || 0), m = Number(mgmt || 0);
            onNext({ rent: r, labor: l, mgmt: m, fixed: r + l + m });
          }}
        >
          다음
        </button>
      </div>
    </QuestionLayout>
  );
}
