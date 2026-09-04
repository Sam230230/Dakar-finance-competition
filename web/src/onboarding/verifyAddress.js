const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";

// 백엔드 precision 값 → 사람이 읽는 단위
const UNIT = { city: "시", district: "구", dong: "동" };

const EXAMPLE = "예: 서울 송파구 올림픽로 300";

/**
 * 주소가 상권 하나를 특정할 만큼 구체적인지 백엔드에 확인한다.
 *
 * 상권(TRDAR)은 한 변이 수백 m라, "서울 송파구" 같은 구 단위 주소로는 어느 상권인지
 * 정해지지 않는다. 그런 주소도 지오코딩은 성공하고(구 중심점) 그 점이 우연히 걸린
 * 상권이 잡히기 때문에, 겉보기에는 정상처럼 보이면서 엉뚱한 상권 지표가 나온다.
 *
 * 검증은 도움이지 관문이 아니다. 백엔드가 죽어 있으면 통과시킨다 —
 * 여기서 막아도 어차피 마지막 분석에서 같은 오류를 만나고, 그때 메시지가 더 정확하다.
 *
 * @param {string} address
 * @returns {Promise<{ok: boolean, message: string, trdarNm?: string}>}
 */
export async function verifyAddress(address) {
  const query = (address || "").trim();
  if (query === "") return { ok: false, message: "주소를 입력해 주세요." };

  let res;
  try {
    res = await fetch(`${API_BASE}/commercial-area`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: query })
    });
  } catch {
    return { ok: true, message: "" }; // 서버에 닿지 못함 — 막지 않는다
  }

  if (res.status === 400) {
    return { ok: false, message: `이 주소를 찾지 못했어요. 도로명 주소로 다시 넣어 주세요. (${EXAMPLE})` };
  }
  if (!res.ok) return { ok: true, message: "" };

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: true, message: "" };
  }

  if (data.trdar_reliable) {
    return { ok: true, message: "", trdarNm: data.trdar_nm };
  }

  const unit = UNIT[data.precision];
  return {
    ok: false,
    message: unit
      ? `${unit} 단위까지만 확인돼요. 상권은 한 구에도 수십 개라 도로명과 건물번호가 필요해요. (${EXAMPLE})`
      : `도로명과 건물번호까지 넣어 주세요. (${EXAMPLE})`
  };
}
