// 결과지 숫자 표기 공통 규칙.
//
// 값이 "없는 것"과 "0인 것"을 반드시 구분한다.
// Number(null) 과 Number("") 은 둘 다 0이라, isFinite 검사만 하면
// 관측값이 없는 상권의 폐업률이 "0.0%"로 나온다. 정보 없음과 정반대 의미라
// 돈이 걸린 화면에서는 그대로 오판으로 이어진다.

const EMPTY = "확인 불가";

/** null, undefined, 빈 문자열, NaN 을 전부 "값 없음"으로 본다. */
function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function money(value) {
  const num = toNumber(value);
  return num == null ? EMPTY : num.toLocaleString("ko-KR");
}

export function percent(value, digits = 1) {
  const num = toNumber(value);
  return num == null ? EMPTY : `${num.toFixed(digits)}%`;
}

export function signed(value, digits = 1) {
  const num = toNumber(value);
  if (num == null) return EMPTY;
  return `${num > 0 ? "+" : ""}${num.toFixed(digits)}%`;
}

/** 사람 수. 만 단위로 접어 읽기 쉽게 한다 (744,376 → "74.4만"). */
export function headcount(value) {
  const num = toNumber(value);
  if (num == null) return EMPTY;
  if (Math.abs(num) < 10000) return num.toLocaleString("ko-KR");
  return `${(num / 10000).toFixed(1)}만`;
}

/** 만원 단위 금액을 읽을 수 있는 크기로 접는다 (3,260 → "3,260만", 5,713,530 → "571억").
 *
 * 사용자가 입력하고 판단하는 돈(내 매출, 이전비)은 A-8 대로 만원 고정이다.
 * 이건 자치구 전체 시장 규모처럼 자릿수가 다른 값 전용 — 만원으로 쓰면
 * "5,713,530만"이 되어 읽을 수가 없다. */
export function scaledWon(manwon) {
  const num = toNumber(manwon);
  if (num == null) return EMPTY;
  const abs = Math.abs(num);
  if (abs < 10000) return `${Math.round(num).toLocaleString("ko-KR")}만`;
  return `${(num / 10000).toLocaleString("ko-KR", { maximumFractionDigits: abs < 100000 ? 1 : 0 })}억`;
}

/** 숫자로 읽을 수 있는 값이 실제로 왔는지. 0 과 "없음"을 구분한다. */
export function hasValue(value) {
  return toNumber(value) != null;
}

export { toNumber, EMPTY };
