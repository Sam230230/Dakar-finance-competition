import { useEffect, useRef, useState } from "react";
import { loadNaverMaps } from "./naverMap";

const NCP_KEY_ID = import.meta.env.VITE_NCP_MAP_KEY_ID;

const COLORS = { current: "#111", A: "#EA002C", B: "#F47725", C: "#2D8CFF" };

/**
 * 현재 매장 + 후보 매장들을 지도에 표시하고, 각 후보에 300/500m 반경 원을 그린다.
 * 결과 화면에서는 recommendedId 로 추천지를 강조하고, competitors(반경 경쟁점포)를 점으로 찍는다.
 *
 * props:
 *   current       : { lat, lng, label }                 // 현재 매장 (선택)
 *   candidates    : [{ site_id, lat, lng, label }]      // 후보 매장들
 *   radii         : [300, 500]                           // 반경(m)
 *   recommendedId : "A"                                  // 추천 후보 강조(선택)
 *   competitors   : [{ lat, lng, name }]                 // 소진공 반경 경쟁점포(선택)
 */
export default function MapView({ current, candidates = [], radii = [300, 500],
                                  recommendedId = null, competitors = [] }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const overlaysRef = useRef([]);
  const [error, setError] = useState("");

  // 1) 지도 1회 생성
  useEffect(() => {
    let cancelled = false;
    loadNaverMaps(NCP_KEY_ID)
      .then((naver) => {
        if (cancelled || !boxRef.current) return;
        mapRef.current = new naver.maps.Map(boxRef.current, {
          center: new naver.maps.LatLng(37.5665, 126.978), // 서울시청 기본값
          zoom: 13,
        });
        draw(); // 최초 렌더
      })
      .catch((e) => setError(e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) 데이터 바뀔 때마다 마커/원 다시 그림
  useEffect(() => { draw(); /* eslint-disable-next-line */ },
    [current, candidates, recommendedId, competitors]);

  function clearOverlays() {
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];
  }

  function draw() {
    const naver = window.naver;
    const map = mapRef.current;
    if (!naver || !map) return;
    clearOverlays();

    const bounds = new naver.maps.LatLngBounds();
    const markerPts = [];
    const addMarker = (lat, lng, text, color, recommended = false) => {
      const pos = new naver.maps.LatLng(lat, lng);
      markerPts.push(pos);
      const ring = recommended ? "border:3px solid #FFD400;transform:scale(1.15);" : "";
      const crown = recommended ? "👑 " : "";
      const marker = new naver.maps.Marker({
        position: pos, map,
        zIndex: recommended ? 1000 : 100,
        icon: {
          content: `<div style="background:${color};color:#fff;padding:4px 9px;border-radius:6px;${ring}
                    font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.35)">${crown}${text}</div>`,
          anchor: new naver.maps.Point(12, 12),
        },
      });
      overlaysRef.current.push(marker);
      bounds.extend(pos);
    };
    // 경쟁점포(소진공) — 작은 점으로만 표시
    const addDot = (lat, lng) => {
      const dot = new naver.maps.Marker({
        position: new naver.maps.LatLng(lat, lng), map, zIndex: 10,
        icon: {
          content: `<div style="width:8px;height:8px;border-radius:50%;background:#888;opacity:.7;border:1px solid #fff"></div>`,
          anchor: new naver.maps.Point(4, 4),
        },
      });
      overlaysRef.current.push(dot);
    };
    const addCircle = (lat, lng, r, color) => {
      const circle = new naver.maps.Circle({
        map, center: new naver.maps.LatLng(lat, lng), radius: r,
        strokeColor: color, strokeOpacity: 0.6, strokeWeight: 1,
        fillColor: color, fillOpacity: 0.06,
      });
      overlaysRef.current.push(circle);
    };

    if (current && current.lat) addMarker(current.lat, current.lng, `현재: ${current.label || "매장"}`, COLORS.current);

    // 경쟁점포 점 먼저(마커 아래 깔리도록)
    competitors.forEach((p) => { if (p.lat) addDot(p.lat, p.lng); });

    candidates.forEach((c) => {
      if (!c.lat) return;
      const isRec = recommendedId && c.site_id === recommendedId;
      const color = COLORS[c.site_id] || "#666";
      addMarker(c.lat, c.lng, `${c.site_id}. ${c.label || ""}`, color, isRec);
      // 추천지는 반경 원을 강조, 나머지는 옅게(추천지가 있을 때)
      radii.forEach((r) => addCircle(c.lat, c.lng, r, color));
    });

    // 마커 개수에 따라 화면 맞춤:
    //  - 1개면 fitBounds가 과도하게 줌아웃되므로 중심+고정 줌
    //  - 2개 이상이면 여백 주고 fitBounds
    if (markerPts.length === 1) {
      map.setCenter(markerPts[0]);
      map.setZoom(15);
    } else if (markerPts.length > 1) {
      map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
    }
    // 컨테이너 크기 변동 대응(레이아웃 확정 후 재계산)
    if (window.naver && naver.maps.Event) {
      setTimeout(() => naver.maps.Event.trigger(map, "resize"), 60);
    }
  }

  if (error) {
    return (
      <div style={ph}>
        지도를 불러오지 못했습니다: {error}
        <div style={{ fontSize: 12, color: "#999", marginTop: 6 }}>
          .env 의 VITE_NCP_MAP_KEY_ID 와 NCP 콘솔의 서비스 도메인 등록을 확인하세요.
        </div>
      </div>
    );
  }
  // 부모(.map, aspect-ratio 16/9)를 꽉 채운다 → 컨테이너와 크기 일치
  return <div ref={boxRef} style={{ width: "100%", height: "100%", minHeight: 320 }} />;
}

const ph = { width: "100%", height: "100%", minHeight: 320, borderRadius: 12, background: "#f2f3f5",
             display: "grid", placeItems: "center", padding: 20, textAlign: "center",
             color: "#c0392b", fontSize: 14 };
