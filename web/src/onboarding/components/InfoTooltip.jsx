import { useEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";

export default function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const wrapRef = useRef(null);
  const bubbleRef = useRef(null);

  // 바깥 클릭 시 닫기 (전역 문서 클릭 리스너)
  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // 화면 경계 충돌 감지: 좌우로 잘리면 안 잘리는 방향으로 위치 보정
  useEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const rect = bubbleRef.current.getBoundingClientRect();
    const margin = 12;
    let s = 0;
    if (rect.left < margin) s = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) s = window.innerWidth - margin - rect.right;
    setShift(s);
  }, [open]);

  return (
    <span className={"info-wrap" + (open ? " show" : "")} ref={wrapRef}>
      <button
        type="button"
        className="info-icon"
        aria-label="설명 보기"
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
      >
        <CircleHelp size={16} strokeWidth={2.1} />
      </button>
      <span
        className="tooltip-bubble"
        role="tooltip"
        ref={bubbleRef}
        style={{ "--tt-shift": `${shift}px` }}
      >
        {text}
      </span>
    </span>
  );
}
