export default function Start({ onScenario, onBlank }) {
  return (
    <div className="single-col">
      <div className="start-brand">Stay or Move</div>
      <h1>
        온보딩 데모 시나리오를
        <br />
        골라서 확인해보세요.
      </h1>
      <p className="sub">
        시나리오를 누르면 결과로 바로 가지 않고, <b>해당 예시값이 채워진 첫 번째 온보딩 질문부터 시작</b>합니다.
        값은 중간에 직접 수정할 수 있어요.
      </p>

      <div className="content">
        <button className="demo-card latest" onClick={() => onScenario(0)}>
          <span className="demo-badge">최신 데이터</span>
          <strong>실제 양도양수 매물로 확인하는 경우</strong>
          <small>
            강동구 카페를 송파구 은평구 금천구 매물과 견줍니다.
            2026년 9월 기준 실매물 값이라 권리금과 보증금 규모가 앞선 두 시나리오보다 훨씬 큽니다.
          </small>
        </button>

        <div className="demo-grid">
          <button className="demo-card one" onClick={() => onScenario(1)}>
            <span className="demo-badge">시나리오 1</span>
            <strong>현재보다 비용이 높은 후보를 검토하는 경우</strong>
            <small>현재 매장과 후보 A B C의 예시값이 미리 채워집니다. 입력 화면을 끝까지 직접 확인할 수 있습니다.</small>
          </button>

          <button className="demo-card two" onClick={() => onScenario(2)}>
            <span className="demo-badge">시나리오 2</span>
            <strong>현재보다 비용이 낮은 후보를 검토하는 경우</strong>
            <small>비용이 낮은 후보 예시값으로 온보딩을 시작하며, 마지막에 회수기간 추가 질문까지 확인할 수 있습니다.</small>
          </button>
        </div>

        <button className="secondary" onClick={onBlank}>
          빈 값으로 직접 시작
        </button>

        <div className="tip">
          시나리오 선택은 실제 사용자에게 "자발/비자발"을 묻는 기능이 아니라 <b>현재 데모 확인용</b>입니다.
          실제 서비스에서는 빈 값으로 시작하고, 모든 입력이 끝난 뒤 시스템이 후보별 비용을 비교해 내부 분기합니다.
        </div>
      </div>
    </div>
  );
}
