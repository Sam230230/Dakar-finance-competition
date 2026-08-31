export default function Prefill({ scenario }) {
  if (!scenario) return null;
  return (
    <div className="prefill">
      시나리오 {scenario} 예시값이 입력되어 있어요 (수정 가능)
    </div>
  );
}
