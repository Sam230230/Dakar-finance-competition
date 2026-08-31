import { useEffect, useState } from "react";

/**
 * "아직 안 쓴 것"과 "썼다가 지운 것"을 구분하는 래치.
 *
 * 값이 처음 채워지는 순간 켜지고 다시 꺼지지 않는다. 덕분에 화면에 막 들어온
 * 사람에게는 빈 칸이 오류로 보이지 않고, 한 번 채웠다가 지운 경우에만
 * 흔들림·빨간 밑줄(.input-line.error)이 붙는다.
 *
 * 선택 항목(권리금 등)과 후보지 입력에는 쓰지 않는다 — 비워두는 게 정상이라서.
 *
 * @param {boolean} filled 지금 값이 채워져 있는지
 * @returns {boolean} 오류 표시를 켤지
 */
export function useClearedError(filled) {
  const [touched, setTouched] = useState(filled);

  useEffect(() => {
    if (filled) setTouched(true);
  }, [filled]);

  return touched && !filled;
}
