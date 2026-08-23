let loadingPromise = null;

export function loadNaverMaps(ncpKeyId) {
  if (window.naver?.maps) return Promise.resolve(window.naver);
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    if (!ncpKeyId) {
      reject(new Error("VITE_NCP_MAP_KEY_ID가 비어 있습니다. 프로젝트 루트 .env를 확인하세요."));
      return;
    }

    const callbackName = `__staymoveNaverReady_${Date.now()}`;
    let settled = false;
    const cleanup = () => {
      try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
    };
    const fail = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    // NAVER 공식 인증 실패 콜백. 인증 실패가 script.onerror로 잡히지 않는 경우가 있어 별도 처리.
    window.navermap_authFailure = () => {
      fail("NAVER 지도 인증에 실패했습니다. Web Dynamic Map 활성화, Web 서비스 URL(http://localhost), Client ID를 확인하세요.");
    };

    window[callbackName] = () => {
      if (settled) return;
      if (!window.naver?.maps) return fail("NAVER Maps 스크립트가 로드됐지만 지도 객체를 찾지 못했습니다.");
      settled = true;
      cleanup();
      resolve(window.naver);
    };

    const script = document.createElement("script");
    script.id = "staymove-naver-map-sdk";
    script.async = true;
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(ncpKeyId)}&callback=${callbackName}`;
    script.onerror = () => fail("NAVER Maps 스크립트를 불러오지 못했습니다. 네트워크 또는 Application 설정을 확인하세요.");
    document.head.appendChild(script);

    setTimeout(() => fail("NAVER Maps 로딩 시간이 초과되었습니다. 키/도메인 등록 상태를 확인하세요."), 10000);
  });

  return loadingPromise;
}
