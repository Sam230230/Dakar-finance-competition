# 결과지 작업 인수인계

작업 브랜치: `feature/result-redesign` (커밋 안 함, 전부 워킹트리 변경분)
마지막 커밋: `201839f 결과지 Codex 버전 확정, 표시 버그 수정과 지도·AI 해석 복원`

규칙 문서: 옵시디언 `Work/stay or move - 작업 규칙.md`, `Work/graph_visualization_uiux_design_notes.md`
결과지 시안: `http://localhost:5173/codex-result.html` (vite dev)

---

## 1. 백엔드 변경 (`ml/runtime.py`)

`market_observed()` 반환에 필드 추가. 전부 이미 있던 데이터를 내보내기만 한 것이라 새 계산 없음.

| 필드 | 뜻 | 기준 |
|---|---|---|
| `store_count`, `franchise_count`, `franchise_share` | 경쟁 지표 | 상권(TRDAR) |
| `change_index`, `change_name` | 상권 변화지표 | 상권 |
| `flow_pop`, `flow_pop_daily`, `flow_pop_qoq_pct`, `flow_pop_quarter` | 유동인구 | 자치구 |
| `flow_pop_history` | 유동인구 8분기 시계열 (일평균) | 자치구 |

`predict_candidate()` 의 `ml` 에 `predicted_district_sales` 추가.
점포당 값(`predicted_monthly_sales`)과 달리 자치구 단위라 `sales_history` 와 같은 축 → 매출 차트에 예측선으로 이어 그릴 수 있다.

**주의**: `predicted_monthly_sales`(점포당, 만원)와 `sales_history`(자치구 합계, 만원)는 4,342배 차이. 절대 같은 축에 놓지 말 것.

---

## 2. 프론트 구조 — 4탭

```
TABS = [상권 정보, 매출 전망, 이전 자금, 종합 판단]   // CodexResultScreen.jsx 상단
```
탭 하나가 질문 하나에 답하도록 재편. 기본 탭은 `TABS[0].id`.

| 탭 | 컴포넌트 | 들어 있는 것 |
|---|---|---|
| 상권 정보 | `MarketPanel` | `MarketTrendChart`(자치구 매출+예측선), `MarketComparison`, `FootfallTrendChart` — **실측만** |
| 매출 전망 | `SalesPanel` | `RequirementBreakdown`, `PredictedSales`, `RecoveryCurve` |
| 이전 자금 | `MoneyPanel` | 소요자금 블록, `PolicySection` |
| 종합 판단 | `SummaryPanel` | `MarginCard`, `AiInsight`, drivers, 후보 비교표 |

---

## 3. 이번에 만든 컴포넌트

전부 `web/src/codex-result/CodexResultScreen.jsx` 안. 공식은 프론트에서 재계산하며 **백엔드 추가 호출 없음**.

- **`RequirementBreakdown`** — 최소 필요매출 분해 스택 바
  `최소필요매출 = 매출×(1−cm) + 후보고정비 + 현재영업이익`
  지금 매장과 나란히 쌓아 "손에 남는 돈" 칸 길이를 맞춤 → 유지비가 늘어 더 팔아야 한다는 인과가 보임

- **`PredictedSales`** — 후보별 ML 예상매출 + 근거 배지
  `data_completeness` 로 `이 상권 실측 기반` / `자치구 평균으로 대체` / `실제 상권 데이터 아님` 구분 (B-15)

- **`RecoveryCurve`** — 회수기간 쌍곡선 + 슬라이더
  `필요매출(m) = (실제이전비/m + 후보고정비 + 현재영업이익) / cm`
  점근선이 곧 유지선. 슬라이더는 **이 섹션 안 미리보기**라 되돌리기 버튼과 경고 문구 필수.
  후보 전환 시 `key={candidate.site_id}` 로 리셋됨

- **`MarginCard`** — 판단 요약 오른쪽 카드 (구 "판단 여유" 교체)
  `남는 몫 = (예상매출×cm − 후보고정비) / 예상매출`, 지금 매장(`영업이익/매출`)과 두 막대 비교
  지금보다 낮으면 `is-risk` 위험색

- **`Sparkline`**, **`Trend`** — 유동인구 추세선, 증감 방향 아이콘
- **`dataRecencyNote`**, **`currentQuarter`**, **`quarterGap`** — 데이터 지연 안내
- **`scaledWon`** (`format.js`) — 1억 미만은 만, 이상은 억. 자치구 매출용
  (사용자가 입력하고 판단하는 돈은 A-8대로 만원 고정)

---

## 4. 반드시 지킬 것

- **금지문자** `·` 절대 금지. 느낌표, 이모지, `~습니다`체도 금지 (해요체). `aria-label`, `title`까지 포함
  검사: `grep -o "[가-힣]*니다" 파일` — `씁니다`처럼 `습니다`로는 안 잡히는 형태 주의
- **대비** 본문 4.5 이상. 눈이 아니라 계산으로 판단 (WCAG 상대휘도)
- **색만으로 의미 전달 금지** — 명도 램프 + 글자/모양 병행
- **B-15** ML 예측과 실측을 같은 블록에 섞지 않기. 자치구 평균 대체값을 일반 예측과 같이 보이지 않기
- **B-3** `requestAnimationFrame` 금지 (`setTimeout` 사용), 아코디언은 `grid-template-rows: 0fr→1fr`
- 변경 후 `npm run build`, `node --test src/codex-result/format.test.js`, `git diff --check`
- 내 변경이 만든 고아 CSS는 제거. 기존 dead code(`cx-eyebrow`)는 손대지 않음

---

## 5. 미해결

1. **네이버 지도 인증 실패** — 키와 포트 모두 정상 확인. SDK가 로드된 뒤(44ms, `Map` 생성자 정상)
   비동기 인증이 거절되며 `naver.maps` 를 null 로 되돌림. 콘솔의 `capitalize` 에러는 2차 증상.
   로더 재시도, 성공 확정 지연, authFailure 상시 훅 세 가지를 시도했으나 모두 실패해 **전부 원복함**
   (`naverMap.js`, `MapView.jsx` 는 HEAD 상태). NCP 콘솔에서 Web Dynamic Map 활성화,
   Web 서비스 URL에 사용 포트 등록, 결제수단, 이용한도를 확인해야 함

2. **경쟁강도 0~1 지표** — 코드베이스와 원격 브랜치 4개 어디에도 없음.
   만든다면 자치구 내 점포수 백분위 추천 (망리단길 0.95, 홍대 0.91, 합정역 0.89로 계산 검증 완료).
   출처 확인 후 진행하기로 하고 보류

3. **자치구 단위 겹침** — `sales_history` 가 자치구 단위라 같은 자치구 후보는 관측선과 예측선이 겹침.
   상권 단위 매출 시계열이 원본에 없어 현재 데이터로는 해결 불가

4. **데이터 지연** — 공공데이터가 2026 Q1까지. 예측 대상 2026 Q2가 이미 지난 분기.
   화면에는 "옅은 구간은 앞날이 아니라 아직 집계 전인 분기예요"로 표시 중

5. `CodexResultScreen.jsx` 1,900줄 — 컴포넌트 파일 분리 필요

---

## 6. 목데이터 주의 (`preview.jsx`)

실제 API와 달리 자기모순이 있어 두 번 고쳤음.
- `current_monthly_fixed_cost` 는 `매출 − 매출×(1−cm) − 영업이익` 과 맞아야 함
- `candidate_fixed_cost` 는 `min_required_sales×cm − 현재영업이익` 과 맞아야 함
새 블록을 붙일 때 목데이터가 비어 있어 렌더가 안 되는 경우가 반복됐으니, 실제 응답 형태를 먼저 확인할 것.
