import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 프론트(5173) → 백엔드(8001) 프록시
// envDir: 상위 폴더(relocation_helper)의 .env 를 읽는다.
//   → VITE_NCP_MAP_KEY_ID, VITE_API_BASE 등을 프로젝트 루트 .env 한 곳에서 관리.
//   (VITE_ 접두사 없는 키(OPENAI, NCP Secret 등)는 프론트 번들에 노출되지 않음)
export default defineConfig({
  plugins: [react()],
  envDir: "..",
  server: {
    port: 5173,
    proxy: {
      "/relocate": "http://localhost:8001",
      "/staymove": "http://localhost:8001",
      "/geocode": "http://localhost:8001",
      "/competitors": "http://localhost:8001",
      "/health": "http://localhost:8001",
    },
  },
});
