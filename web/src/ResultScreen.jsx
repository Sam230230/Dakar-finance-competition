import CodexResultScreen from "./codex-result/CodexResultScreen.jsx";
import "./codex-result/codex-result.css";

/**
 * 실제 분석 결과 진입점.
 * 별도 시안에서 확정한 결과지를 실제 API 응답에 그대로 연결한다.
 *
 * places 는 주소를 좌표와 상권코드로 바꾼 결과(지도용),
 * aiState 는 /staymove/explain 성공 여부다. 둘 다 App 이 이미 만들어 두는 값이라
 * 여기서 끊으면 지도와 AI 해석이 화면에서 통째로 사라진다.
 */
export default function ResultScreen({ data, places, aiState, onRestart }) {
  return <CodexResultScreen data={data} places={places} aiState={aiState} onRestart={onRestart} />;
}
