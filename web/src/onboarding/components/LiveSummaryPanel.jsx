import {
  MapPin,
  TrendingUp,
  Receipt,
  Building2,
  Wallet,
  Map,
  CircleCheckBig,
  ChevronLeft
} from "lucide-react";
import { money } from "../logic.js";

// 단계마다 무엇을 묻는지 형태로 먼저 읽히도록 하는 아이콘
const STEP_ICON = {
  1: MapPin,
  2: TrendingUp,
  3: Receipt,
  4: Building2,
  5: Wallet,
  6: Map,
  7: CircleCheckBig
};

// 단계별로 "이 입력이 무엇을 준비하고, 어디에 쓰이는지" 안내
const STEP_WHY = {
  1: {
    title: "이 주소를 기준으로 동네 상권을 불러와요",
    body: "나중에 후보지와 나란히 놓고 비교할 수 있어요."
  },
  2: {
    title: "모든 계산의 기준이 되는 숫자예요",
    body: "이전 후 최소 얼마를 팔아야 하는지, 지금의 몇 %인지가 여기서 나와요."
  },
  3: {
    title: "매출에서 빼고 남는 돈을 계산해요",
    body: "이 비율을 알아야 '이전 후 필요한 매출'을 거꾸로 구할 수 있어요."
  },
  4: {
    title: "지금 매장을 유지하는 데 매달 드는 돈이에요",
    body: "후보지 월세와 나란히 놓고, 비용이 늘어날지 줄어들지 판단해요."
  },
  5: {
    title: "이전에 실제로 쓸 수 있는 돈을 확인해요",
    body: "이전비가 이 금액을 넘으면, 얼마가 더 필요한지 알려드려요."
  },
  6: {
    title: "매달 드는 돈과 한 번 드는 돈을 나눠서 봐요",
    body: "회수하는 방식이 달라서 따로 계산해요. 최대 세 곳까지 비교할 수 있어요."
  },
  7: {
    title: "입력하신 값으로 후보별 기준을 계산했어요",
    body: "후보마다 무엇을 먼저 봐야 하는지 다르게 정리해드려요."
  }
};

function buildItems(data) {
  const totalCash =
    Number(data.current.cash || 0) + Number(data.current.depositReturn || 0) + Number(data.current.keyMoneyRecovery || 0);
  const candidateDoneCount = data.candidates.filter(c => (c.address || "").trim() !== "").length;

  return [
    { cur: 1, label: "현재 매장 위치", value: data.current.address || null },
    { cur: 2, label: "월평균 매출", value: data.current.sales != null ? money(data.current.sales) : null },
    { cur: 3, label: "월 변동비", value: data.current.variable != null ? money(data.current.variable) : null },
    { cur: 4, label: "월 고정비", value: data.current.fixed != null ? money(data.current.fixed) : null },
    { cur: 5, label: "가용현금", value: data.current.cash != null ? money(totalCash) : null },
    {
      cur: 6,
      label: "후보지",
      value: candidateDoneCount > 0 ? data.candidates.map(c => c.address).filter(Boolean).join(" · ") : null
    },
    { cur: 7, label: "결과 확인", value: null }
  ];
}

function LiveMetric({ data, cur }) {
  // 시나리오 데모는 current 값을 미리 다 채워두기 때문에, 데이터 존재 여부가 아니라
  // "마법사가 실제로 그 스텝을 지났는지"(cur) 기준으로 공개해야 스포일러가 안 생김
  const S = Number(data.current.sales || 0);
  const variable = Number(data.current.variable || 0);
  const fixed = Number(data.current.fixed || 0);

  if (cur < 3) {
    return (
      <div className="live-metric">
        <div className="live-metric-label">
          <span className="pulse" />
          실시간 계산
        </div>
        <div className="live-metric-placeholder">답해주시는 대로 여기에서 바로 계산해드려요.</div>
      </div>
    );
  }

  if (cur < 4) {
    return (
      <div className="live-metric">
        <div className="live-metric-label">
          <span className="pulse" />한 달 매출
        </div>
        <div className="live-metric-value">{money(S)}</div>
        <div className="live-metric-pending">변동비까지 알려주시면 남는 돈이 보여요</div>
      </div>
    );
  }

  const gross = S - variable;

  if (cur < 5) {
    return (
      <div className="live-metric">
        <div className="live-metric-label">
          <span className="pulse" />
          변동비 빼고 남은 돈
        </div>
        <div className="live-metric-value">{money(gross)}</div>
        <div className="live-metric-formula">
          매출 <b>{money(S)}</b>에서 변동비 <b>{money(variable)}</b>을 뺐어요
        </div>
        <div className="live-metric-pending">고정비까지 넣으면 매달 손에 남는 돈이 나와요</div>
      </div>
    );
  }

  const profit = gross - fixed;
  const short = profit < 0;

  return (
    <div className="live-metric">
      <div className="live-metric-label">
        <span className="pulse" />
        {short ? "매달 모자라는 돈" : "매달 손에 남는 돈"}
      </div>
      <div className={"live-metric-value" + (short ? " negative" : "")}>{money(Math.abs(profit))}</div>
      <div className="live-metric-formula">
        매출 <b>{money(S)}</b>에서 변동비 <b>{money(variable)}</b>, 고정비 <b>{money(fixed)}</b>을 뺐어요
      </div>
    </div>
  );
}

export default function LiveSummaryPanel({ data, cur, total = 7, showBack, onBack, onJump }) {
  const items = buildItems(data);
  const why = STEP_WHY[cur];

  return (
    <aside className="panel">
      <div className="panel-top">
        <span className="panel-brand">Stay or Move</span>
        <span className="panel-stepno">
          {cur}/{total}
        </span>
      </div>

      <button
        className="panel-back"
        style={{ visibility: showBack ? "visible" : "hidden" }}
        onClick={onBack}
      >
        <ChevronLeft size={18} strokeWidth={2.4} aria-hidden="true" />
        이전
      </button>

      {why && (
        <div className="step-why">
          <div className="step-why-label">이 답변으로 준비하는 것</div>
          <p className="step-why-title">{why.title}</p>
          <p className="step-why-body">{why.body}</p>
        </div>
      )}

      <div className="track">
        {items.map(item => {
          const state = item.cur < cur ? "done" : item.cur === cur ? "active" : "pending";
          const Icon = STEP_ICON[item.cur];
          const node = (
            <span className="track-node" aria-hidden="true">
              <Icon size={15} strokeWidth={2.2} />
            </span>
          );

          // 이미 답한 단계는 눌러서 그 단계로 바로 돌아갈 수 있음
          if (state === "done") {
            return (
              <button
                type="button"
                className="track-item done jumpable"
                key={item.cur}
                onClick={() => onJump(item.cur)}
                title={`${item.label} 단계로 돌아가기`}
              >
                {node}
                <span className="track-label">{item.label}</span>
                <span className="track-value">
                  {item.value || "-"}
                  <span className="track-jump-hint">수정</span>
                </span>
              </button>
            );
          }

          return (
            <div className={"track-item " + state} key={item.cur}>
              {node}
              <span className="track-label">{item.label}</span>
              {state === "active" && (
                <span className="track-value">
                  <span className="track-active-badge">입력 중</span>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <LiveMetric data={data} cur={cur} />
    </aside>
  );
}
