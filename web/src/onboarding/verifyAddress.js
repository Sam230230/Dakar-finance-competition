const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";

// 백엔드 precision 값 → 사람이 읽는 단위
const UNIT = { city: "시", district: "구", dong: "동" };

const EXAMPLE = "예: 서울 송파구 올림픽로 300";

/**
 * 주소를 확인하고 무엇을 알려줄지 정한다.
 *
 * 서비스라서 어떤 주소를 넣어도 결과는 나와야 한다. 그래서 진행을 막는 경우는
 * "주소가 비었다" 하나뿐이다. 나머지는 전부 통과시키고 무엇이 부정확해지는지만 말한다.
 *
 * 상권(TRDAR)은 한 변이 수백 m라 "서울 송파구" 같은 주소로는 어느 상권인지 정해지지
 * 않는다. 그래도 손익·회수 계산은 매출과 비용만으로 나오므로 결과 자체는 유효하다.
 * 부정확해지는 건 상권 지표(예상매출·점포 수·안정도·정책)뿐이다.
 *
 * @returns {Promise<{ok: boolean, message: string, tone?: "warn"|"error", trdarNm?: string}>}
 *   ok=false 는 빈 주소일 때만. message 가 있으면 그대로 보여주되 진행은 허용한다.
 */
export async function verifyAddress(address) {
  const query = (address || "").trim();
  if (query === "") return { ok: false, message: "주소를 입력해 주세요.", tone: "error" };

  let res;
  try {
    res = await fetch(`${API_BASE}/commercial-area`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: query })
    });
  } catch {
    return { ok: true, message: "" }; // 서버에 닿지 못함 — 조용히 통과
  }

  if (res.status === 400) {
    return {
      ok: true,
      tone: "warn",
      message: `이 주소를 찾지 못했어요. 상권 지표 없이 손익 계산만 보여드려요. (${EXAMPLE})`
    };
  }
  if (!res.ok) return { ok: true, message: "" }; // 서버 설정·네트워크 문제 — 사용자 잘못이 아니다

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: true, message: "" };
  }

  if (data.area_confidence === "unsupported") {
    return {
      ok: true,
      tone: "warn",
      message: `상권 데이터는 서울시만 있어요. ${data.sido || "이 지역"} 주소는 손익 계산만 보여드려요.`
    };
  }

  if (data.trdar_reliable) {
    return { ok: true, message: "", trdarNm: data.trdar_nm };
  }

  const unit = UNIT[data.precision];
  const where = data.trdar_nm ? `가장 가까운 ‘${data.trdar_nm}’ 상권 기준으로 보여드려요.` : "";
  return {
    ok: true,
    tone: "warn",
    message: unit
      ? `${unit} 단위까지만 확인돼요. ${where} 정확히 보려면 도로명과 건물번호를 넣어 주세요. (${EXAMPLE})`
      : `주소가 상권 밖이에요. ${where} (${EXAMPLE})`
  };
}
