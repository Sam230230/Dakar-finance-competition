// NAVER Maps JS v3 로더 — 스크립트를 한 번만 삽입하고 Promise 로 준비 완료를 알린다.
// (2025 이후 파라미터명이 ncpClientId → ncpKeyId 로 변경됨)

let _loading = null;

export function loadNaverMaps(ncpKeyId) {
  if (window.naver && window.naver.maps) return Promise.resolve(window.naver);
  if (_loading) return _loading;

  _loading = new Promise((resolve, reject) => {
    if (!ncpKeyId) {
      reject(new Error("VITE_NCP_MAP_KEY_ID 가 설정되지 않았습니다(.env)."));
      return;
    }
    const s = document.createElement("script");
    s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${ncpKeyId}`;
    s.async = true;
    s.onload = () => resolve(window.naver);
    s.onerror = () => reject(new Error("NAVER Maps 스크립트 로드 실패(키/도메인 등록 확인)."));
    document.head.appendChild(s);
  });
  return _loading;
}
