export default function Prefill({ scenario }) {
  // 0(최신 데이터)도 유효한 시나리오다. falsy 검사로 거르면 배지가 통째로 사라진다.
  if (scenario === null || scenario === undefined) return null;
  const name = scenario === 0 ? "최신 데이터" : `시나리오 ${scenario}`;
  return (
    <div className="prefill">
      {name} 예시값이 입력되어 있어요 (수정 가능)
    </div>
  );
}
