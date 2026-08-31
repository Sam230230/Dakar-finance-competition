# 온보딩 화면 (web/)

`feature/onboarding-redesign` 브랜치에서 온보딩 UI를 전면 교체했습니다.
**결과 화면·지도·백엔드 연동 로직은 기존 것을 그대로 씁니다.**

## 무엇이 바뀌었나

| 구분 | 파일 | 상태 |
|---|---|---|
| 온보딩 UI | `src/onboarding/**` | **신규** |
| 화면 흐름·API 호출 | `src/App.jsx` | **교체** (API 호출부는 기존 로직 유지) |
| 결과 화면 | `src/ResultScreen.jsx` | 기존 유지 |
| 지도 | `src/MapView.jsx`, `src/naverMap.js` | 기존 유지 |
| 결과 문구 헬퍼 | `src/insights.js` | 기존 유지 |
| 기존 스타일 | `src/styles.css` | 기존 유지 (결과·로딩·지도용) |

### 온보딩 흐름 변경

기존 8단계에서 **7단계**로 줄었습니다.

```text
1 현재 주소
2 월평균 매출
3 월 변동비
4 월 고정비          ← 월세·인건비·관리비 3칸으로 나눠 묻고 합계를 fixed_cost로 전송
5 가용현금            ← 바로 쓸 수 있는 현금 + 보증금 반환 예상액 (+ 권리금 회수, 선택)
6 후보지 조건         ← 기존의 "후보 수 선택 → A → B → C" 4단계를 아코디언 1단계로 통합
7 비교 → (회수기간) → 분석
```

좌측에는 지금까지 답한 값과 실시간 손익을 보여주는 프리뷰 패널이 붙습니다.

---

## 보증금과 권리금 처리 (근사)

**백엔드를 고치지 않는 대신 계산이 근사가 되는 부분이 있습니다. 나중에 정확도가 문제가 되면 여기부터 보세요.**

> **2026-08-31: 팀 논의 결과 B안 채택.** 권리금을 `available_self_fund`에서 제외했습니다.
> 아래 "② 권리금이 확정 현금처럼 취급됨" 문제는 **해결되었고**, 남은 근사는 ① 하나입니다.

### 백엔드가 하는 계산

```python
# engine/rule_engine.py
net_deposit_change = candidate.deposit - current.deposit          # 추가로 묶이는 보증금
initial_relocation_capital = actual_relocation_cost + max(0, net_deposit_change)

# staymove.py
additional_fund_needed = max(0, initial_relocation_capital - current.self_fund)
```

`current.deposit`은 **계약서상 보증금**을 뜻합니다. 보증금은 쓰는 돈이 아니라 묶이는 돈이라,
현재와 후보의 **차액만** 자금 소요로 잡는 구조입니다.

### 온보딩에서 바꾼 질문

| | 원래 | 온보딩 |
|---|---|---|
| 보증금 | "현재 매장 보증금은?" → 계약서상 금액 | "보증금 반환 예상액" → 밀린 임대료·원상복구비를 뺀 **순액** |
| 권리금 | 질문 없음 | "권리금을 받고 나갈 계획이 있어요" (선택) |

사용자가 실제로 손에 쥐는 금액을 묻는 게 맞다고 봤지만, 백엔드는 이 둘을 구분하지 않습니다.

### 현재 매핑 방식

```js
// web/src/onboarding/logic.js → toStayMovePayload()
deposit:             보증금 반환 예상액          // 계약서상 금액 자리에 순액을 넣음
available_self_fund: 바로 쓸 수 있는 현금        // 권리금 제외 (B안)
```

권리금 입력값은 상태에 그대로 남아 있습니다. 백엔드가 필드를 나눠 받게 되면
이 어댑터만 고쳐서 바로 쓸 수 있습니다.

### 이렇게 하면 생기는 오차

**① 보증금 차액이 부풀려집니다 — 보수적 방향**

계약서상 3,000 / 반환 예상 2,700 / 후보지 5,000 (단위: 만원)인 경우:

| | 정확한 계산 | 지금 방식 |
|---|---|---|
| `current.deposit` | 3,000 | **2,700** |
| `net_deposit_change` | 2,000 | **2,300** |

300만원이 과대 계상됩니다. 이 300만원은 원상복구비 등으로 실제 나가는 돈이 맞지만,
`actual_relocation_cost`에 원상복구비가 이미 포함돼 있어 **이중 계상될 여지**가 있습니다.

**② 권리금이 확정 현금처럼 취급됨 — 해결됨 (B안)**

전에는 권리금을 `available_self_fund`에 더해 보냈습니다.
백엔드의 `self_fund`는 통장에 있는 확정 현금을 전제로 쓰이는데,
권리금은 새 임차인이 나타나야 받는 돈이라 확정이 아닙니다.
합산하면 자금이 덜 필요하다고 나와서 낙관적 오판을 부릅니다.

**지금은 합산하지 않습니다.** 온보딩은 여전히 권리금을 묻지만 계산에는 넣지 않습니다.

### 남은 오차는 하나, 방향은 보수적입니다

| 오차 | 방향 | 판단 영향 |
|---|---|---|
| ① 보증금 차액 과대 | 자금이 **더** 필요하다고 나옴 | 안전 |
| ~~② 권리금을 현금과 동일 취급~~ | — | **해결됨 (B안)** |

낙관 방향의 오차가 사라져 전체가 보수적으로 일관됩니다.

**남은 과제**: 권리금을 물어놓고 계산에 쓰지 않게 되었습니다.
결과 화면에 "권리금 N만원을 받으면 추가 필요자금이 그만큼 줄어요" 같은 참고 안내를
붙이는 것이 좋습니다. `ResultScreen.jsx` 수정이 필요해 이 브랜치 범위 밖입니다.

### 정확하게 고치려면

백엔드에 필드를 나눠 받아야 합니다.

```python
current: {
  contract_deposit: 3000,          # 계약서상 — net_deposit_change 계산용
  deposit_refund_expected: 2700,   # 반환 예상 순액 — 실제 동원 가능액
  key_money_recovery: 1000,        # 권리금 — 불확실 자금으로 별도 취급
}
```

- `engine/rule_engine.py` → `net_deposit_change`가 `contract_deposit`을 보도록
- `staymove.py` → `self_fund` 합산에서 권리금을 별도 항목으로 분리
- 온보딩 → **"계약서상 보증금"** 질문 추가 (지금은 순액만 묻고 있음)

프론트는 순액·권리금을 이미 상태로 갖고 있어, 어댑터(`toStayMovePayload`)만 고치면 됩니다.

---

## 로컬 실행

```bash
# 백엔드 (레포 루트에서)
uvicorn api.main:app --port 8001

# 프론트
cd web
npm install
npm run dev
```

기본 API 주소는 `http://localhost:8001`이고, `.env`의 `VITE_API_BASE`로 바꿀 수 있습니다.

### 확인된 동작

레포 백엔드(포트 8002)로 온보딩 → 분석 → 결과까지 끝까지 검증했습니다.
`/staymove?explain=false` 응답의 `analysis_id`·`candidates`가 정상적으로 오고,
`ResultScreen`이 기대하는 필드(`min_required_sales`, `additional_fund_needed`, `ml`, `policy_rag` 등)가 모두 채워집니다.

### 알려진 환경 이슈

- `policy_rag`는 `faiss` 패키지가 없으면 비활성화됩니다(`ModuleNotFoundError: No module named 'faiss'`).
  결과 화면의 정책금융 영역만 비고, 나머지 분석은 정상 동작합니다.
- ML artifact가 scikit-learn 1.9.0으로 학습되어 1.7.2에서 로드하면 경고가 납니다(동작에는 문제 없음).

## 새로 추가된 의존성

- `lucide-react` — 온보딩 아이콘
- Pretendard 서체 (`index.html`에서 CDN 로드)
