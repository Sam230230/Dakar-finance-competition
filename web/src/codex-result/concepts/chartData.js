export const chartCandidates = [
  {
    id: "A",
    name: "성수동 연무장길",
    shortName: "성수동",
    need: 17.6,
    expect: 27.9,
    margin: 8.7,
    needWon: 3292,
    expectWon: 3580,
    summary: "예상 여유는 충분하지만 현재보다 큰 폭의 매출 성장이 필요해요.",
  },
  {
    id: "B",
    name: "망원동 포은로",
    shortName: "망원동",
    need: 2.1,
    expect: 11.4,
    margin: 9.1,
    needWon: 2860,
    expectWon: 3120,
    recommended: true,
    summary: "필요한 성장 폭은 작고 예상 여유는 가장 커 균형이 좋아요.",
  },
  {
    id: "C",
    name: "문래동 도림로",
    shortName: "문래동",
    need: -1.4,
    expect: 0.7,
    margin: 2.2,
    needWon: 2760,
    expectWon: 2820,
    summary: "현재 매출로 기준을 충족하지만 예상 여유가 크지 않아요.",
  },
];

export const won = (value) => `${value.toLocaleString("ko-KR")}만원`;
export const signedPercent = (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
