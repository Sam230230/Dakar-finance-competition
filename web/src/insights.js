// Deterministic "value + diff + one-line meaning" helpers.
// These exist so numeric interpretations never depend on the LLM (see AI section
// prompt rules in staymove.py) — anything computable directly from response
// fields is computed here instead.

export function n(v) {
  return v === "" || v == null ? 0 : Number(v);
}
export function money(v) {
  return Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString("ko-KR") : "-";
}
export function pct(v, digits = 1) {
  return Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(digits)}%` : "-";
}
export function signed(v) {
  const num = Number(v);
  if (!Number.isFinite(num)) return "-";
  return `${num >= 0 ? "+" : ""}${money(num)}`;
}

/** predicted vs. minimum-required sales: value + diff + meaning. */
export function salesBufferLine(predicted, minRequired) {
  if (!Number.isFinite(Number(predicted)) || !Number.isFinite(Number(minRequired)) || !minRequired) {
    return "ML 예상매출 정보가 없어 매출 여유를 계산할 수 없습니다.";
  }
  const diff = predicted - minRequired;
  const ratio = (diff / minRequired) * 100;
  if (diff >= 0) {
    return `최소 필요매출보다 ${money(diff)}만원 높아 약 ${ratio.toFixed(1)}%의 매출 여유가 있습니다.`;
  }
  return `최소 필요매출보다 ${money(Math.abs(diff))}만원 낮아 약 ${Math.abs(ratio).toFixed(1)}% 매출을 더 올려야 합니다.`;
}

/** candidate monthly operating cost vs. current fixed cost. */
export function monthlyCostDeltaLine(delta) {
  const num = Number(delta);
  if (!Number.isFinite(num)) return "-";
  if (num > 0) return `현재 대비 +${money(num)}만원 — 매달 ${money(num)}만원의 추가 고정비를 감당해야 합니다.`;
  if (num < 0) return `현재 대비 ${money(num)}만원 — 매달 ${money(Math.abs(num))}만원의 고정비를 절감합니다.`;
  return "현재와 동일한 월 고정비입니다.";
}

/** initial move capital vs. how much additional funding is needed. */
export function capitalLine(initialCapital, additionalNeeded) {
  const need = Number(additionalNeeded);
  if (!Number.isFinite(need)) return "-";
  if (need <= 0) return "현재 입력한 자기자금 안에서 이전 가능합니다.";
  return `자기자금 반영 후 ${money(need)}만원이 추가로 필요합니다.`;
}

/** predicted sales vs. a target-recovery-period required sales figure. */
export function recoveryTargetLine(predicted, requiredSales) {
  if (!Number.isFinite(Number(predicted)) || !Number.isFinite(Number(requiredSales))) {
    return "회수기간 기준 비교값을 계산할 수 없습니다.";
  }
  const diff = predicted - requiredSales;
  if (diff >= 0) return `목표 대비 +${money(diff)}만원 여유`;
  return `목표에 ${money(Math.abs(diff))}만원 부족`;
}

/**
 * Compares one candidate's value against the best-scoring OTHER candidate for
 * the same metric (never an aggregate) — matches the "후보 A보다 2.3%p 낮음"
 * phrasing style used throughout the result screen.
 *
 * `scale` converts the raw stored value into the unit named by `unit` before
 * diffing — e.g. closure_probability/retention are stored as 0-1 fractions,
 * so callers must pass `scale: 100` to get a correct "%p" diff. Passing
 * already-percentage values (like district_trend.quarterly_growth_pct) keeps
 * the default `scale: 1`. This was the exact source of a bug where mixing a
 * 0-1 fraction with a "%p" label silently produced diffs ~100x too small
 * (e.g. "0.2%p" instead of "21.6%p").
 */
export function relativeToBestOtherLine(siteId, valuesBySite, { lowerIsBetter = false, unit = "", decimals = 1, scale = 1 } = {}) {
  const scaled = Object.fromEntries(
    Object.entries(valuesBySite)
      .filter(([, v]) => Number.isFinite(Number(v)))
      .map(([id, v]) => [id, Number(v) * scale])
  );
  const mine = scaled[siteId];
  const others = Object.entries(scaled).filter(([id]) => id !== siteId);
  if (!Number.isFinite(mine) || !others.length) return null;
  const best = others.reduce((acc, [id, v]) => {
    const better = lowerIsBetter ? v < acc[1] : v > acc[1];
    return better ? [id, v] : acc;
  }, others[0]);
  const [bestId, bestValue] = best;
  const diff = mine - bestValue;
  if (Math.abs(diff) < 10 ** -decimals) return `후보 ${bestId}와 비슷함`;
  // Direction wording reflects the actual numeric comparison (mine vs. bestValue) —
  // lowerIsBetter only decides *which other candidate* counts as "best" above, it must
  // not also flip which way "높음/낮음" points, or the two cancel out incorrectly.
  return `후보 ${bestId}보다 ${Math.abs(diff).toFixed(decimals)}${unit} ${diff > 0 ? "높음" : "낮음"}`;
}

export function recoveryRelevanceLabel(relevance) {
  return relevance === "primary" ? "주요지표" : "성장 후보이므로 보조지표로 참고";
}

export function fundPriorityLine(priority) {
  return priority === "low"
    ? "자기자금으로 이전 가능하지만, 시설/운전자금을 활용하면 현금 소진을 줄일 수 있습니다."
    : "추가 자금 필요성이 커 정책금융 활용 우선도가 높습니다.";
}
