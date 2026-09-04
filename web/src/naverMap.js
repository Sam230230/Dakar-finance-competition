let loadingPromise = null;

const READY_TIMEOUT_MS = 20000;

// NCP 키는 두 세대가 섞여 있다.
//   구형 발급분: ncpClientId
//   신형 발급분: ncpKeyId
// 파라미터가 키 형식과 안 맞으면 서버가 401을 주고, 스크립트는 window.naver.maps 를
// "빈 객체"로만 만들어 둔 채 끝난다. naver.maps 존재 여부만 보면 성공으로 착각하게 된다.
//
// 순서가 중요하다. 실패한 스크립트가 나중에 실행되면 이미 채워진 naver.maps 를
// 빈 객체로 덮어써서, 성공했다가 다시 망가지는 일이 생긴다.
// 그래서 한 번에 하나씩만 붙이고, 앞의 것이 확실히 실패한 뒤에만 다음으로 넘어간다.
// ncpKeyId 를 앞에 둔다. 인증 엔드포인트에 직접 물어보니 ncpClientId 는 지금 쓰는
// 키에 대해 InvalidParameter 로 즉시 거절된다 — 구형 파라미터는 폐기됐다.
// 뒤에 남겨두는 건 아직 구형 발급분을 쓰는 환경이 있을 경우의 대비일 뿐이다.
const KEY_PARAMS = ["ncpKeyId", "ncpClientId"];

/** 네임스페이스만 생긴 게 아니라 실제로 쓸 수 있는 상태인지 확인한다. */
function mapsReady() {
  return typeof window.naver?.maps?.Map === "function";
}

/**
 * 네이버 지도 SDK 로더.
 *
 * 판정과 재시도를 전부 "이벤트"로 한다. 타이머로 폴링하지 않는다.
 * 탭이 오래 숨어 있으면 크롬이 백그라운드 타이머를 분당 1회까지 조여서,
 * 100ms 폴링이 20초 동안 한 번도 안 도는 걸 실제로 확인했다.
 * SDK 콜백, script.onerror, navermap_authFailure 는 그 영향을 받지 않는다.
 *
 * 준비 판정은 naver.maps 가 아니라 naver.maps.Map 으로 한다.
 * 인증이 거절되면 naver.maps 는 빈 객체로 남고, 그걸 성공으로 보면
 * 바로 다음 줄의 new naver.maps.Map 에서 터진다.
 *
 * 실패한 프라미스는 캐시에 남기지 않는다. 남기면 이후 모든 호출이 같은 실패를
 * 돌려받아 세션 내내 지도가 안 뜬다.
 */
export function loadNaverMaps(keyId) {
  if (mapsReady()) return Promise.resolve(window.naver);
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    if (!keyId) {
      reject(new Error("VITE_NCP_MAP_KEY_ID가 비어 있습니다. 프로젝트 루트 .env를 확인하세요."));
      return;
    }

    const scripts = [];
    const callbacks = [];
    let settled = false;
    let tried = 0;
    let timeoutId = null;

    const cleanup = () => {
      clearTimeout(timeoutId);
      callbacks.forEach((name) => {
        try { delete window[name]; } catch { window[name] = undefined; }
      });
      if (window.navermap_authFailure === authFailure) window.navermap_authFailure = undefined;
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(window.naver);
    };

    const fail = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      loadingPromise = null; // 다음 마운트가 처음부터 다시 시도하도록
      scripts.forEach((el) => el.remove());
      reject(new Error(message));
    };

    // 한 파라미터로 실패하면 다음 세대 파라미터로 즉시 넘어간다.
    const escalate = () => {
      if (settled) return;
      if (mapsReady()) return succeed();
      if (tried < KEY_PARAMS.length) {
        // 실패한 스크립트를 먼저 떼어낸다. 남겨두면 뒤늦게 실행되면서
        // 다음 스크립트가 채운 naver.maps 를 빈 객체로 덮어쓸 수 있다.
        scripts.forEach((el) => el.remove());
        scripts.length = 0;
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          if (mapsReady()) return succeed();
          escalate();
        }, READY_TIMEOUT_MS);
        return inject();
      }
      fail("NAVER 지도를 불러오지 못했습니다. Web Dynamic Map 활성화와 Web 서비스 URL 등록, 그리고 키를 확인해 주세요.");
    };

    // 인증 실패가 script.onerror 로 잡히지 않는 경우가 있어 공식 콜백도 받는다.
    function authFailure() {
      escalate();
    }
    window.navermap_authFailure = authFailure;

    function inject() {
      const param = KEY_PARAMS[tried];
      tried += 1;

      const callbackName = `__staymoveNaverReady_${param}_${Date.now()}`;
      callbacks.push(callbackName);
      // SDK가 준비를 알리는 콜백. 인증이 거절된 경우에도 불리는 걸 확인했으므로
      // 여기서 반드시 Map 생성자 존재를 확인한 뒤에 성공으로 본다.
      // 콜백이 왔는데 아직 Map 이 없더라도 실패로 보지 않는다.
      // v3 SDK는 서브모듈을 더 받은 뒤에 채우기 때문에, 여기서 스크립트를 떼면
      // 정상적으로 로딩 중이던 것을 죽이게 된다. 실패 판정은 인증 실패 신호에 맡긴다.
      window[callbackName] = () => {
        if (mapsReady()) succeed();
      };

      const script = document.createElement("script");
      script.id = `staymove-naver-map-sdk-${param}`;
      script.async = true;
      script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?${param}=${encodeURIComponent(keyId)}&callback=${callbackName}`;
      // 콜백이 아예 안 오는 경우까지 덮는다.
      script.onload = () => { if (!settled && mapsReady()) succeed(); };
      script.onerror = () => escalate();
      document.head.appendChild(script);
      scripts.push(script);
    }

    // 이벤트가 하나도 안 오는 최악의 경우를 위한 마지막 방어선.
    timeoutId = setTimeout(() => {
      if (mapsReady()) return succeed();
      escalate(); // 남은 키 파라미터가 있으면 그걸로 한 번 더, 없으면 실패
    }, READY_TIMEOUT_MS);

    inject();
  });

  return loadingPromise;
}
