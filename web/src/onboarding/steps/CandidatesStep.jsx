import { useEffect, useRef, useState } from "react";
import { ChevronDown, Trash2, Plus } from "lucide-react";
import QuestionLayout from "../components/QuestionLayout.jsx";
import Prefill from "../components/Prefill.jsx";
import InfoTooltip from "../components/InfoTooltip.jsx";
import { emptyCandidate, monthly, money, labels } from "../logic.js";
import { verifyAddress } from "../verifyAddress.js";

const isFilled = c => (c.address || "").trim() !== "";

export default function CandidatesStep({ candidates, prefillScenario, onNext }) {
  const [list, setList] = useState(() => {
    const seed = (candidates || []).filter(c => c);
    return seed.length ? seed.map(c => ({ ...c })) : [emptyCandidate()];
  });
  // 한 번에 한 카드만 펼친다. 처음엔 모두 접힌 상태로 시작.
  const [openIndex, setOpenIndex] = useState(null);
  // 후보 index → 주소 지적 문구
  const [rejects, setRejects] = useState({});
  const [checking, setChecking] = useState(false);
  // "입력 완료"로 지금 확인 중인 카드 index. 카드마다 따로 눌리므로 하나만 잡아두면 된다.
  const [verifying, setVerifying] = useState(null);
  // 지적이 붙었을 때 그 카드의 주소 칸으로 커서를 되돌리기 위한 참조
  const addrRefs = useRef({});
  // 포커스 모드(제목·형제 카드·하단 버튼 감춤) 대상.
  // openIndex와 따로 두는 이유: 두 변화를 같은 프레임에 일으키면 형제 카드가
  // display:none으로 사라지는 리플로우 때문에 브라우저가 아코디언 트랜지션의
  // 시작값을 잡지 못해 애니메이션이 통째로 건너뛰어진다. 한 프레임 차를 둔다.
  const [focusIndex, setFocusIndex] = useState(null);
  const focus = focusIndex !== null;

  const listRef = useRef(null);
  const lastClosedRef = useRef(null);
  const timersRef = useRef([]);
  // 포커스가 풀릴 때 한 번만 등장 애니메이션을 태우기 위한 플래그.
  // 감췄던 요소들이 같은 프레임에 한꺼번에 나타나면 뚝 끊기는 느낌이 난다.
  const [restoring, setRestoring] = useState(false);
  // 제목 펼침 상태. focus와 따로 두는 이유는 아래 useEffect 주석 참고
  const [headOpen, setHeadOpen] = useState(true);
  const lastFocusRef = useRef(null);
  const wasFocusRef = useRef(false);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  const COLLAPSE_MS = 300; // .cand-body 트랜지션과 맞춤

  function patch(i, key, value) {
    setList(l => l.map((c, idx) => (idx === i ? { ...c, [key]: value } : c)));
    if (key === "address") setRejects(r => (r[i] ? { ...r, [i]: "" } : r));
  }

  // 채워진 후보 주소를 한꺼번에 확인한다. 서로 독립이라 동시에 던진다.
  // 하나라도 걸리면 그 카드를 펴서 어디가 문제인지 바로 보이게 한다.
  async function submit() {
    if (checking) return;
    const filledRows = list.map((c, i) => ({ c, i })).filter(({ c }) => isFilled(c));
    setChecking(true);
    const results = await Promise.all(filledRows.map(({ c }) => verifyAddress(c.address)));
    setChecking(false);

    const next = {};
    let firstBad = null;
    results.forEach((result, n) => {
      if (result.ok) return;
      const { i } = filledRows[n];
      next[i] = result.message;
      if (firstBad === null) firstBad = i;
    });
    setRejects(next);
    if (firstBad !== null) {
      openCard(firstBad);
      return;
    }

    onNext(
      filledRows.map(({ c }) => ({
        ...c,
        address: c.address.trim(),
        rent: Number(c.rent || 0),
        management: Number(c.management || 0),
        otherFixed: Number(c.otherFixed || 0),
        deposit: Number(c.deposit || 0),
        interior: Number(c.interior || 0),
        moving: Number(c.moving || 0),
        restoration: Number(c.restoration || 0),
        rights: Number(c.rights || 0),
        otherMove: Number(c.otherMove || 0),
        closedDays: Number(c.closedDays || 0)
      }))
    );
  }

  function openCard(i) {
    lastFocusRef.current = i;
    setFocusIndex(i); // 먼저 화면을 정리하고
    // 한 틱 뒤에 펼쳐야 애니메이션이 산다.
    // rAF는 창이 가려지면 스로틀돼 아예 안 열릴 수 있어 타이머를 쓴다.
    const t = setTimeout(() => setOpenIndex(i), 0);
    timersRef.current.push(t);
  }

  // "입력 완료"는 카드를 닫기 전에 그 카드 주소만 확인한다.
  // 세 곳을 다 채운 뒤 마지막에 몰아서 알려주면 되돌아가는 비용이 크다.
  async function completeCard(i) {
    if (verifying !== null) return;
    setVerifying(i);
    const result = await verifyAddress(list[i].address);
    setVerifying(null);

    if (!result.ok) {
      setRejects(r => ({ ...r, [i]: result.message }));
      // 카드는 닫지 않고 고칠 자리로 되돌린다
      const input = addrRefs.current[i];
      if (input) {
        input.focus();
        input.select();
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        input.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      }
      return;
    }

    setRejects(r => (r[i] ? { ...r, [i]: "" } : r));
    closeCard(i);
  }

  function closeCard(i) {
    lastClosedRef.current = i;
    setOpenIndex(null); // 먼저 말려 올라가고
    const t = setTimeout(() => setFocusIndex(null), COLLAPSE_MS); // 다 접힌 뒤 화면 복원
    timersRef.current.push(t);
  }

  function addOne() {
    if (list.length >= 3) return;
    setList(l => [...l, emptyCandidate()]);
    openCard(list.length); // 새로 추가한 카드는 바로 펼쳐서 입력하게
  }

  function removeAt(i) {
    setList(l => l.filter((_, idx) => idx !== i));
    const shift = prev => {
      if (prev === i) return null;
      if (prev != null && prev > i) return prev - 1;
      return prev;
    };
    setOpenIndex(shift);
    setFocusIndex(shift);
  }

  const RESTORE_MS = 420; // 등장 애니메이션 + 스태거가 끝나는 시점

  // 제목 펼침은 focus와 한 프레임 어긋나게 둔다.
  // 형제 카드가 display:none에서 돌아오는 리플로우와 같은 커밋에 묶이면
  // 브라우저가 트랜지션 시작값을 못 잡아 제목이 그냥 튄다.
  useEffect(() => {
    if (focus) {
      setHeadOpen(false);
      return;
    }
    const t = setTimeout(() => setHeadOpen(true), 0);
    timersRef.current.push(t);
    return () => clearTimeout(t);
  }, [focus]);

  useEffect(() => {
    if (wasFocusRef.current && !focus) {
      setRestoring(true);
      const t = setTimeout(() => setRestoring(false), RESTORE_MS);
      timersRef.current.push(t);
    }
    wasFocusRef.current = focus;
  }, [focus]);

  useEffect(() => {
    // 모션 축소 설정을 켠 사용자에게는 스크롤도 즉시 이동
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = reduce ? "auto" : "smooth";
    if (focus) {
      // 펼친 카드가 화면 맨 위에서 시작하도록
      window.scrollTo({ top: 0, behavior });
    } else if (lastClosedRef.current != null && listRef.current) {
      // 접힐 때 방금 편집한 카드가 눈에 보이는 위치에 오도록
      const card = listRef.current.children[lastClosedRef.current];
      if (card) card.scrollIntoView({ block: "nearest", behavior });
      lastClosedRef.current = null;
    }
  }, [focus]);

  const ready = isFilled(list[0]);

  return (
    <QuestionLayout
      left={
        /* 조건부 렌더 대신 높이를 접었다 편다. 언마운트하면 되돌아올 때 연출이 안 걸린다 */
        <div className={"q-head-collapse" + (headOpen ? " open" : "")}>
          <div className="q-head-inner">
            <div className="q-head-slide">
              <h1>
                이전할 후보지의
                <br />
                조건을 알려주세요.
              </h1>
              <p className="sub">
                후보지를 눌러 정보를 입력해 주세요. 상권과 <b>정책정보</b>도 함께 보여드려요.
                <InfoTooltip text="[메모] 정책정보를 어떤 기준으로, 어떤 항목을 보여줄지 안내 문구는 추후 추가 예정" />
              </p>
            </div>
          </div>
        </div>
      }
    >
      {focus ? (
        <div className="focus-crumb">
          <b>후보지 {labels[focusIndex]}</b> 정보를 입력하고 있어요
        </div>
      ) : (
        <div className={restoring ? "is-returning" : undefined}>
          <Prefill scenario={prefillScenario} />
        </div>
      )}

      <div className="content">
        <div className="cand-list" ref={listRef}>
          {list.map((c, i) => {
            const open = openIndex === i;
            const filled = isFilled(c);
            return (
              <div
                className={
                  "cand-card" +
                  (open ? " open" : "") +
                  (focus && focusIndex !== i ? " is-hidden" : "") +
                  (restoring && lastFocusRef.current !== i ? " is-returning" : "")
                }
                key={i}
              >
                <div className="cand-head">
                  <button
                    type="button"
                    className="cand-toggle"
                    aria-expanded={open}
                    onClick={() => (open ? closeCard(i) : openCard(i))}
                  >
                    <span className="cand-name">
                      후보지 {labels[i]}
                      {i === 0 ? <span className="tag-req">필수</span> : <span className="tag-opt">선택</span>}
                    </span>
                    <span className={"cand-summary" + (filled ? " filled" : "")}>
                      {filled ? `${c.address}, 월 ${money(monthly(c))}` : "정보를 입력해 주세요"}
                    </span>
                    <span className="cand-chevron" aria-hidden="true">
                      <ChevronDown size={18} strokeWidth={2.2} />
                    </span>
                  </button>

                  {i > 0 && (
                    <button
                      type="button"
                      className="cand-delete"
                      aria-label={`후보지 ${labels[i]} 삭제`}
                      title={`후보지 ${labels[i]} 삭제`}
                      onClick={() => removeAt(i)}
                    >
                      <Trash2 size={17} strokeWidth={2} />
                    </button>
                  )}
                </div>

                <div className="cand-body">
                  <div className="cand-body-inner">
                    <div className="field">
                      <label>주소</label>
                      <input
                        ref={el => { addrRefs.current[i] = el; }}
                        value={c.address || ""}
                        onChange={e => patch(i, "address", e.target.value)}
                        placeholder="예: 서울 성동구 성수이로 22"
                        aria-invalid={rejects[i] ? "true" : undefined}
                      />
                      {rejects[i] ? <p className="field-reject" role="alert">{rejects[i]}</p> : null}
                    </div>

                    <div className="section-label">매달 반복되는 비용</div>
                    <div className="two">
                      <div className="field">
                        <label>월세</label>
                        <input type="number" min="0" value={c.rent ?? ""} onChange={e => patch(i, "rent", e.target.value)} placeholder="만원" />
                      </div>
                      <div className="field">
                        <label>관리비</label>
                        <input type="number" min="0" value={c.management ?? ""} onChange={e => patch(i, "management", e.target.value)} placeholder="만원" />
                      </div>
                    </div>
                    <div className="field">
                      <label>기타 고정비</label>
                      <input type="number" min="0" value={c.otherFixed ?? ""} onChange={e => patch(i, "otherFixed", e.target.value)} placeholder="만원" />
                    </div>
                    <div className="mini-help">월세 + 관리비 + 기타 고정비를 합쳐 현재 매장 월 고정비와 비교합니다.</div>

                    <div className="section-label">한 번 발생하는 이전비</div>
                    <div className="two">
                      <div className="field">
                        <label>보증금</label>
                        <input type="number" min="0" value={c.deposit ?? ""} onChange={e => patch(i, "deposit", e.target.value)} placeholder="만원" />
                      </div>
                      <div className="field">
                        <label>인테리어비</label>
                        <input type="number" min="0" value={c.interior ?? ""} onChange={e => patch(i, "interior", e.target.value)} placeholder="만원" />
                      </div>
                    </div>
                    <div className="two">
                      <div className="field">
                        <label>이사비</label>
                        <input type="number" min="0" value={c.moving ?? ""} onChange={e => patch(i, "moving", e.target.value)} placeholder="만원" />
                      </div>
                      <div className="field">
                        <label>원상복구비</label>
                        <input type="number" min="0" value={c.restoration ?? ""} onChange={e => patch(i, "restoration", e.target.value)} placeholder="만원" />
                      </div>
                    </div>
                    <div className="two">
                      <div className="field">
                        <label>권리금</label>
                        <input type="number" min="0" value={c.rights ?? ""} onChange={e => patch(i, "rights", e.target.value)} placeholder="만원" />
                      </div>
                      <div className="field">
                        <label>기타 이전비</label>
                        <input type="number" min="0" value={c.otherMove ?? ""} onChange={e => patch(i, "otherMove", e.target.value)} placeholder="만원" />
                      </div>
                    </div>
                    <div className="field">
                      <label>예상 휴업일수</label>
                      <input type="number" min="0" value={c.closedDays ?? ""} onChange={e => patch(i, "closedDays", e.target.value)} placeholder="일" />
                    </div>

                    <button
                      type="button"
                      className="cand-done"
                      disabled={!filled || verifying === i}
                      onClick={() => completeCard(i)}
                    >
                      {verifying === i ? "주소 확인 중…" : "입력 완료"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {focus ? null : list.length < 3 ? (
          <button type="button" className={"add-btn" + (restoring ? " is-returning" : "")} onClick={addOne}>
            <span className="plus-circle">
              <Plus size={13} strokeWidth={3} />
            </span>{" "}
            후보지 추가
          </button>
        ) : (
          <p className={"max-note" + (restoring ? " is-returning" : "")}>후보지는 최대 3곳까지 비교할 수 있어요.</p>
        )}
      </div>

      <div className={"footer" + (restoring ? " is-returning" : "")} style={{ display: focus ? "none" : undefined }}>
        <button className="next" disabled={!ready || checking} onClick={submit}>
          {checking ? "주소 확인 중…" : "다음"}
        </button>
      </div>
    </QuestionLayout>
  );
}
