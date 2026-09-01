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

export { toNumber, EMPTY };
