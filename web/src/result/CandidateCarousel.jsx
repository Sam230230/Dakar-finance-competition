import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { money } from "../insights";

/**
 * 후보 A/B/C를 카드로 나눠 옆으로 넘겨 보는 캐러셀.
 *
 * 스크롤 스냅을 기반으로 한다. 손으로 짠 드래그 계산보다 터치 감이 좋고,
 * 관성과 접근성(키보드, 스크린리더)이 브라우저 기본 동작으로 따라온다.
 * 데스크톱 마우스 드래그만 포인터 이벤트로 scrollLeft에 연결해 보완한다.
 */
export default function CandidateCarousel({ rows, ranking, selectedId, onSelect }) {
  const viewportRef = useRef(null);
  const cardRefs = useRef([]);
  const allBelow = !!ranking?.all_below_threshold;
  const order = ranking?.ranking?.length ? ranking.ranking : rows.map(r => r.site_id);
  const ordered = order.map(id => rows.find(r => r.site_id === id)).filter(Boolean);

  const [centerId, setCenterId] = useState(selectedId);
  const idsKey = ordered.map(c => c.site_id).join("|");

  // 뷰포트 중앙선에 가장 가까운 카드를 가운데로 본다.
  const measure = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !vp.clientWidth) return;
    const mid = vp.getBoundingClientRect().left + vp.clientWidth / 2;
    let best = null, bestDist = Infinity;
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    const id = best != null ? idsKey.split("|")[best] : null;
    if (id) setCenterId(prev => (prev === id ? prev : id));
  }, [idsKey]);

  // 스크롤 이벤트만 믿지 않는다. 환경에 따라 프로그램적 스크롤에서 이벤트가 안 오기도 하고,
  // 스냅이 끝나는 시점도 브라우저마다 다르다. 상호작용 직후 잠깐 rAF로 훑는다.
  const pollRef = useRef(0);
  const startPoll = useCallback(() => {
    const until = performance.now() + 900;
    if (pollRef.current) return;
    const tick = () => {
      measure();
      if (performance.now() < until) pollRef.current = requestAnimationFrame(tick);
      else pollRef.current = 0;
    };
    pollRef.current = requestAnimationFrame(tick);
  }, [measure]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    measure();
    const onScroll = () => { measure(); startPoll(); };
    vp.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      vp.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      if (pollRef.current) cancelAnimationFrame(pollRef.current);
      pollRef.current = 0;
    };
  }, [measure, startPoll]);

  // 가운데 카드가 바뀌면 아래 상세도 따라간다
  useEffect(() => {
    if (centerId && centerId !== selectedId) onSelect(centerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId]);

  // 점과 키보드는 스크롤 감지를 기다리지 않고 바로 확정한다.
  // 감지에만 의존하면 이벤트가 안 오는 환경에서 조작이 통째로 먹통이 된다.
  function scrollToIndex(i) {
    const id = idsKey.split("|")[i];
    if (id) setCenterId(id);
    const el = cardRefs.current[i];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    startPoll();
  }

  // 데스크톱 마우스 드래그. 터치는 브라우저 기본 스크롤이 처리한다.
  const drag = useRef(null);
  function onPointerDown(e) {
    if (e.pointerType === "touch") return;
    const vp = viewportRef.current;
    drag.current = { x: e.clientX, left: vp.scrollLeft, moved: false };
    vp.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    viewportRef.current.scrollLeft = d.left - dx;
  }
  function onPointerUp(e) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    try { viewportRef.current.releasePointerCapture(e.pointerId); } catch { /* 이미 해제됨 */ }
    startPoll();
  }

  function onKeyDown(e) {
    const i = ordered.findIndex(c => c.site_id === centerId);
    if (e.key === "ArrowRight" && i < ordered.length - 1) { e.preventDefault(); scrollToIndex(i + 1); }
    if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); scrollToIndex(i - 1); }
  }

  return (
    <div className="cc">
      <div
        className="cc-viewport"
        ref={viewportRef}
        role="listbox"
        aria-label="후보지 카드, 좌우로 넘겨서 하나씩 볼 수 있어요"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="cc-pad" aria-hidden="true" />
        {ordered.map((c, i) => (
          <CandidateCard
            key={c.site_id}
            ref={el => (cardRefs.current[i] = el)}
            c={c}
            rank={i + 1}
            allBelow={allBelow}
            active={centerId === c.site_id}
            onClick={() => scrollToIndex(i)}
          />
        ))}
        <div className="cc-pad" aria-hidden="true" />
      </div>

      <div className="cc-dots" role="tablist" aria-label="후보 선택">
        {ordered.map((c, i) => (
          <button
            key={c.site_id}
            type="button"
            role="tab"
            aria-selected={centerId === c.site_id}
            aria-label={`후보 ${c.site_id} 보기`}
            className={"cc-dot" + (centerId === c.site_id ? " on" : "")}
            onClick={() => scrollToIndex(i)}
          >
            <span>{c.site_id}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const CandidateCard = forwardRef(function CandidateCard({ c, rank, allBelow, active, onClick }, ref) {
  const buffer = c.ml?.predicted_monthly_sales != null && c.min_required_sales != null
    ? c.ml.predicted_monthly_sales - c.min_required_sales
    : null;
  const short = buffer != null && buffer < 0;
  const needMore = (c.additional_fund_needed || 0) > 0;

  return (
    <article
      ref={ref}
      className={"cc-card" + (active ? " on" : "")}
      onClick={onClick}
      role="option"
      aria-selected={active}
    >
      <div className="cc-rank">
        <span className="cc-badge">{allBelow ? `상대적 ${rank}순위` : `${rank}순위`}</span>
        <span className="cc-site">후보 {c.site_id}</span>
      </div>

      <h3 className="cc-name">{c.name}</h3>
      <p className="cc-mode">
        {c.analysis_mode === "growth_opportunity"
          ? "비용은 늘지만 더 벌 수 있는 자리인지 봐요"
          : "비용을 줄이고 이전비를 얼마나 빨리 되찾는지 봐요"}
      </p>

      <div className="cc-main">
        <span className="cc-main-label">매달 이만큼은 팔아야 해요</span>
        <strong className="cc-main-value">{money(c.min_required_sales)}<em>만원</em></strong>
        {buffer != null && (
          <span className={"cc-main-note" + (short ? " warn" : "")}>
            {short
              ? `예상 매출로는 ${money(Math.abs(buffer))}만원 모자라요`
              : `예상 매출이 ${money(buffer)}만원 더 많아요`}
          </span>
        )}
      </div>

      <dl className="cc-facts">
        <div>
          <dt>매달 드는 돈</dt>
          <dd>{money(c.monthly_operating_cost)}만원</dd>
        </div>
        <div>
          <dt>옮기는 데 드는 돈</dt>
          <dd>{money(c.initial_capital)}만원</dd>
        </div>
        <div className={needMore ? "warn" : ""}>
          <dt>더 필요한 돈</dt>
          <dd>{needMore ? `${money(c.additional_fund_needed)}만원` : "없어요"}</dd>
        </div>
      </dl>
    </article>
  );
});
