import { useEffect, useRef, useState } from "react";
import { loadNaverMaps } from "./naverMap";

const KEY_ID = import.meta.env.VITE_NCP_MAP_KEY_ID;
// ResultScreen의 SITE_COLOR와 같은 명도 램프.
// 밝은 채움 위에는 흰 글씨가 안 읽혀서 글자색을 짝으로 둔다.
const COLORS = { current: "#121619", A: "#046B36", B: "#02C551", C: "#8CDCB0" };
const INK = { current: "#fff", A: "#fff", B: "#062B16", C: "#062B16" };

export default function MapView({ current, candidates = [], selectedId = null, activeKey = null, showBoundaries = false, onMapClick }) {
  const hostRef = useRef(null);
  // 네이버 SDK는 컨테이너 안에 자기 DOM을 직접 심는다. React가 렌더한 노드에 그대로
  // 심으면 언마운트할 때 React가 모르는 자식을 만나 리컨실리에이션이 터진다
  // (Cannot read properties of null (reading 'isArray')).
  // 그래서 지도는 React 바깥에서 만든 자식 div 안에서만 살게 한다.
  const innerRef = useRef(null);
  const mapRef = useRef(null);
  const overlaysRef = useRef([]);
  const clickListenerRef = useRef(null);
  const [error, setError] = useState("");
  // 한 번 실패했다고 세션 내내 포기하지 않는다. 값이 바뀌면 로더를 다시 태운다.
  const [attempt, setAttempt] = useState(0);

  // 탭이 가려진 동안 SDK 로딩이 스로틀돼 실패했다면, 화면이 다시 보일 때 재시도한다.
  useEffect(() => {
    if (!error) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") setAttempt((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [error]);

  useEffect(() => {
    let cancelled = false;
    setError("");
    loadNaverMaps(KEY_ID)
      .then((naver) => {
        if (cancelled || !hostRef.current) return;
        innerRef.current?.remove();
        const inner = document.createElement("div");
        inner.style.width = "100%";
        inner.style.height = "100%";
        hostRef.current.appendChild(inner);
        innerRef.current = inner;
        const map = new naver.maps.Map(inner, {
          center: new naver.maps.LatLng(37.5563, 126.9140),
          zoom: 14,
          zoomControl: true,
          zoomControlOptions: { position: naver.maps.Position.RIGHT_CENTER },
          scaleControl: false,
          mapDataControl: false,
          logoControlOptions: { position: naver.maps.Position.BOTTOM_LEFT },
        });
        mapRef.current = map;
        clickListenerRef.current = naver.maps.Event.addListener(map, "click", (e) => {
          if (!onMapClick) return;
          const coord = e.coord || e.latlng;
          onMapClick({ lat: coord.y, lng: coord.x });
        });
        renderOverlays();
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      if (window.naver?.maps && clickListenerRef.current) window.naver.maps.Event.removeListener(clickListenerRef.current);
      clear();
      mapRef.current = null;
      // React가 이 노드를 치우기 전에 우리가 만든 자식을 우리가 걷어낸다.
      innerRef.current?.remove();
      innerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => { renderOverlays(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [current, candidates, selectedId, activeKey, showBoundaries]);

  function clear() {
    overlaysRef.current.forEach((overlay) => overlay?.setMap?.(null));
    overlaysRef.current = [];
  }

  function drawBoundary(naver, map, geometry, color, strong) {
    if (!geometry?.coordinates) return;
    const polygons = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
    polygons.forEach((polygon) => {
      const paths = polygon.map((ring) => ring.map(([lng, lat]) => new naver.maps.LatLng(lat, lng)));
      const shape = new naver.maps.Polygon({
        map,
        paths,
        strokeColor: color,
        strokeWeight: strong ? 4 : 2,
        strokeOpacity: strong ? .9 : .5,
        fillColor: color,
        fillOpacity: strong ? .13 : .045,
      });
      overlaysRef.current.push(shape);
    });
  }

  function addMarker(naver, map, item, key, selected, bounds, points) {
    if (!Number.isFinite(Number(item?.lat)) || !Number.isFinite(Number(item?.lng))) return;
    const pos = new naver.maps.LatLng(Number(item.lat), Number(item.lng));
    const color = COLORS[key] || "#5b6168";
    const ink = INK[key] || "#fff";
    const label = key === "current" ? "현재" : key;
    bounds.extend(pos);
    points.push(pos);

    const html = `<div style="display:flex;align-items:center;gap:7px;padding:6px 10px 6px 6px;background:#fff;border:1px solid rgba(17,17,17,.18);border-radius:999px;box-shadow:0 10px 28px rgba(0,0,0,.15);font:800 11px 'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,sans-serif;white-space:nowrap;${selected ? `outline:4px solid ${color}25;` : ""}"><span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:${color};color:${ink};font-size:9px">${label}</span><span style="max-width:145px;overflow:hidden;text-overflow:ellipsis;color:#121619">${escapeHtml(item.label || "위치")}</span></div>`;
    const marker = new naver.maps.Marker({ map, position: pos, zIndex: selected ? 300 : 180, icon: { content: html, anchor: new naver.maps.Point(18, 18) } });
    overlaysRef.current.push(marker);
    if (showBoundaries && item.boundary) drawBoundary(naver, map, item.boundary, color, selected);
  }

  function renderOverlays() {
    const naver = window.naver;
    const map = mapRef.current;
    if (!naver?.maps || !map) return;
    clear();
    const bounds = new naver.maps.LatLngBounds();
    const points = [];
    if (current) addMarker(naver, map, current, "current", activeKey === "current", bounds, points);
    candidates.forEach((candidate) => addMarker(naver, map, candidate, candidate.site_id, candidate.site_id === selectedId || activeKey === candidate.site_id, bounds, points));
    if (points.length === 1) { map.setCenter(points[0]); map.setZoom(16); }
    else if (points.length > 1) map.fitBounds(bounds, { top: 90, right: 90, bottom: 90, left: 90 });
    else { map.setCenter(new naver.maps.LatLng(37.5563, 126.9140)); map.setZoom(14); }
    setTimeout(() => naver.maps.Event.trigger(map, "resize"), 60);
  }

  if (error) {
    return (
      <div className="map-error">
        <div>
          <strong>네이버 지도를 불러오지 못했어요.</strong>
          <span>{error}</span>
          <button type="button" className="map-retry" onClick={() => setAttempt((n) => n + 1)}>다시 불러오기</button>
          <small>Application에서 Web Dynamic Map이 활성화되어 있고, Web 서비스 URL이 <b>http://localhost</b>로 등록되어 있는지 확인해 주세요. .env를 고쳤다면 Vite를 다시 시작해야 해요.</small>
        </div>
      </div>
    );
  }
  return <div ref={hostRef} className="naver-map-canvas" aria-label="NAVER 지도" />;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}
