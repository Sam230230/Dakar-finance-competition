import { test } from "node:test";
import assert from "node:assert/strict";
import { hasValue, headcount, money, percent, scaledWon, signed } from "./format.js";

// 실제로 났던 버그의 회귀 테스트.
// 실측 스냅샷이 없는 상권은 close_rate 와 sales_yoy 가 null 로 오는데,
// Number(null) === 0 이라 화면에 "0.0%" 로 찍혔다. 폐업률 0%는 "정보 없음"과
// 정반대 의미라 그대로 두면 사용자가 안전한 상권으로 오독한다.
test("percent: null 과 undefined 는 0%가 아니라 확인 불가", () => {
  assert.equal(percent(null), "확인 불가");
  assert.equal(percent(undefined), "확인 불가");
  assert.equal(percent(""), "확인 불가");
});

test("percent: 진짜 0 은 0.0% 로 표시한다", () => {
  assert.equal(percent(0), "0.0%");
});

test("signed: null 은 확인 불가, 실제 값은 부호를 붙인다", () => {
  assert.equal(signed(null), "확인 불가");
  assert.equal(signed(0), "0.0%");
  assert.equal(signed(-15.1), "-15.1%");
  assert.equal(signed(4.2), "+4.2%");
});

test("money: null 은 확인 불가, 숫자는 천 단위 콤마", () => {
  assert.equal(money(null), "확인 불가");
  assert.equal(money(""), "확인 불가");
  assert.equal(money(0), "0");
  assert.equal(money(3292), "3,292");
});

test("headcount: 만 단위로 접고, 값이 없으면 확인 불가", () => {
  assert.equal(headcount(null), "확인 불가");
  assert.equal(headcount(0), "0");
  assert.equal(headcount(9999), "9,999");
  assert.equal(headcount(744376), "74.4만");
});

test("hasValue: 0 은 값이 있는 것, null 과 빈 문자열은 없는 것", () => {
  assert.equal(hasValue(0), true);
  assert.equal(hasValue(119), true);
  assert.equal(hasValue(null), false);
  assert.equal(hasValue(undefined), false);
  assert.equal(hasValue(""), false);
});

// 자치구 매출은 만원으로 쓰면 "5,713,530만"이 되어 축 라벨이 읽히지 않는다.
test("scaledWon: 1억 미만은 만, 이상은 억으로 접는다", () => {
  assert.equal(scaledWon(null), "확인 불가");
  assert.equal(scaledWon(3260), "3,260만");
  assert.equal(scaledWon(9999), "9,999만");
  assert.equal(scaledWon(10000), "1억");
  assert.equal(scaledWon(57135), "5.7억");
  assert.equal(scaledWon(5713530), "571억");
});
