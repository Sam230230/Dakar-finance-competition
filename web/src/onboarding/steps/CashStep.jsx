import { useEffect, useState } from "react";
import QuestionLayout from "../components/QuestionLayout.jsx";
import Prefill from "../components/Prefill.jsx";
import ChipRow from "../components/ChipRow.jsx";
import InfoTooltip from "../components/InfoTooltip.jsx";
import { money } from "../logic.js";

export default function CashStep({ current, prefillScenario, onNext }) {
  const [cash, setCash] = useState(current.cash ?? "");
  const [deposit, setDeposit] = useState(current.depositReturn ?? "");
  const [keyAmount, setKeyAmount] = useState(current.keyMoneyRecovery ?? "");
  const keyPrefilled = (current.keyMoneyRecovery ?? "") !== "" && Number(current.keyMoneyRecovery) > 0;
  // keyIntent = 사용자가 누른 상태, keyOn = 실제로 펼쳐진 상태.
  // 둘을 분리해 한 프레임 페인트한 뒤 펼쳐야 트랜지션이 살아난다.
  const [keyIntent, setKeyIntent] = useState(keyPrefilled);
  const [keyOn, setKeyOn] = useState(keyPrefilled);

  // 한 번 펼쳐지면 계속 열어둔다. 첫 금액을 다시 지워도 접히지 않고,
  // 대신 그 칸에 에러를 표시해 "여기를 채워야 한다"를 알려주기 위함.
  const [revealed, setRevealed] = useState(cash !== "");
  useEffect(() => {
    if (cash === "" || revealed) return;
    // 값 입력으로 생긴 레이아웃 변화가 한 번 정리된 뒤에 펼쳐야
    // 브라우저가 트랜지션 시작값을 제대로 잡는다(즉시 튐 방지).
    let inner;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setRevealed(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [cash, revealed]);

  const total = (Number(cash) || 0) + (Number(deposit) || 0) + (Number(keyAmount) || 0);
  const ready = cash !== "" && deposit !== "";

  // 펼침은 한 프레임 페인트한 뒤에 적용해야 트랜지션이 산다.
  // (클릭 핸들러 안에서 바로 켜면 브라우저가 시작값을 잡지 못하고 즉시 완료됨)
  useEffect(() => {
    if (keyIntent && !keyOn) {
      const t = setTimeout(() => setKeyOn(true), 0);
      return () => clearTimeout(t);
    }
    if (!keyIntent && keyOn) setKeyOn(false);
  }, [keyIntent, keyOn]);

  function toggleKey() {
    const next = !keyIntent;
    setKeyIntent(next);
    if (!next) setKeyAmount("");
  }

  return (
    <QuestionLayout
      left={
        <>
          <h1>
            현재 보유 중인
            <br />
            가용현금은 얼마인가요?
          </h1>
        </>
      }
    >
      <Prefill scenario={prefillScenario} />

      <div className="content">
        <div className="field-block">
          <div className="field-block-head">
            <span className="field-block-label">바로 쓸 수 있는 현금</span>
            <span className="tag-req">필수</span>
          </div>
          <div className={"input-line" + (revealed && cash === "" ? " error" : "")}>
            <input type="number" min="0" value={cash} onChange={e => setCash(e.target.value)} placeholder="0" />
            <span className="unit">만원</span>
          </div>
          <ChipRow options={[500, 1000, 2000, 3000]} value={cash} onSelect={setCash} />
        </div>

        <div className={"reveal-group" + (revealed ? " open" : "")}>
          <div className="reveal-inner">
          <div className="field-block">
            <div className="field-block-head">
              <span className="field-block-label">
                보증금 반환 예상액
                <InfoTooltip text="계약서상 보증금이 아니라, 밀린 임대료·원상복구비 등을 제외한 순액이에요. 확실하지 않다면 보증금의 80~90%로 잡아도 괜찮아요." />
              </span>
              <span className="tag-req">필수</span>
            </div>
            <div className="input-line">
              <input type="number" min="0" value={deposit} onChange={e => setDeposit(e.target.value)} placeholder="0" />
              <span className="unit">만원</span>
            </div>
            <ChipRow
              options={[
                { v: 2000, label: "2,000만원" },
                { v: 5000, label: "5,000만원" },
                { v: 8000, label: "8,000만원" },
                { v: 10000, label: "1억원" }
              ]}
              value={deposit}
              onSelect={setDeposit}
            />
          </div>

          <div className="field-block">
            <div
              className="toggle-row"
              role="switch"
              aria-checked={keyIntent}
              tabIndex={0}
              onClick={e => {
                if (e.target.closest(".info-wrap")) return;
                toggleKey();
              }}
              onKeyDown={e => {
                if ((e.key === "Enter" || e.key === " ") && !e.target.closest(".info-wrap")) {
                  e.preventDefault();
                  toggleKey();
                }
              }}
            >
              <span className="toggle-text">
                권리금을 받고 나갈 계획이 있어요
                <span className="tag-opt">선택</span>
                <InfoTooltip text="권리금은 새 임차인이 나타나야 받는 돈이라 확정된 게 아니에요. 세금 등을 감안해 보수적으로 적어주세요." />
              </span>
              <span className={"switch" + (keyOn ? " on" : "")}>
                <span className="knob" />
              </span>
            </div>
            <div className={"keymoney-body" + (keyOn ? " open" : "")}>
              <div className="keymoney-inner">
              <div className="input-line">
                <input type="number" min="0" value={keyAmount} onChange={e => setKeyAmount(e.target.value)} placeholder="0" />
                <span className="unit">만원</span>
              </div>
              <ChipRow
                options={[
                  { v: 3000, label: "3,000만원" },
                  { v: 6000, label: "6,000만원" },
                  { v: 10000, label: "1억원" },
                  { v: 20000, label: "2억원" }
                ]}
                value={keyAmount}
                onSelect={setKeyAmount}
              />
              </div>
            </div>
            </div>
          </div>
        </div>

        <div className="sum-box">
          <span className="sum-label">총 가용현금</span>
          <span className="sum-value">{money(total)}</span>
        </div>
      </div>

      <div className="footer">
        <button
          className="next"
          disabled={!ready}
          onClick={() =>
            onNext({
              cash: Number(cash || 0),
              depositReturn: Number(deposit || 0),
              keyMoneyRecovery: Number(keyAmount || 0)
            })
          }
        >
          다음
        </button>
      </div>
    </QuestionLayout>
  );
}
