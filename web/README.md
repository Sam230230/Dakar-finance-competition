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

## ⚠️ 보증금·권리금 처리 (근사)

**백엔드를 고치지 않는 대신 계산이 근사가 되는 부분이 있습니다. 나중에 정확도가 문제가 되면 여기부터 보세요.**

### 배경

백엔드 `current.deposit`은 원래 이런 뜻입니다.

```python
# engine/rule_engine.py
deposit: float = 0.0   # 현재 보증금(회수되어 후보 보증금에 재투입 가능)
net_deposit_change = candidate.deposit - current.deposit
```

그런데 온보딩에서는 사용자가 답하기 쉽도록 질문을 이렇게 바꿨습니다.

- **"보증금 반환 예상액"** — 계약서상 보증금이 아니라, 밀린 임대료·원상복구비를 뺀 **순액**
- **"권리금을 받고 나갈 계획이 있어요"** — 권리금 회수 예상액 (선택 입력)

### 현재 매핑 방식

```js
// web/src/onboarding/logic.js → toStayMovePayload()
deposit:             보증금 반환 예상액          // 현재 보증금 자리에 순액을 넣음
available_self_fund: 바로 쓸 수 있는 현금 + 권리금 회수 예상액
```

### 이렇게 하면 생기는 오차

1. **`net_deposit_change`가 실제보다 크게 잡힙니다.**
   계약서상 보증금(예: 3,000만원) 대신 순액(예: 2,700만원)을 넣으므로,
   `후보 보증금 − 현재 보증금` 차액이 300만원만큼 과대 계상됩니다.
   → 초기 이전 소요자금이 보수적으로(= 더 크게) 나옵니다.

2. **권리금이 보증금이 아닌 자기자금으로 들어갑니다.**
   이전에 동원 가능한 **총액은 정확**하지만, 백엔드가 보증금과 자기자금을
   따로 구분해 쓰는 계산(있다면)에서는 성격이 달라집니다.

두 오차 모두 **보수적인 방향**(자금이 더 필요하다고 나오는 쪽)이라 판단을 낙관하게 만들지는 않습니다.

### 정확하게 고치려면

백엔드에 필드를 추가해야 합니다.

- `current.contract_deposit` — 계약서상 보증금 (net_deposit_change 계산용)
- `current.deposit_refund_expected` — 반환 예상 순액 (실제 동원 가능액)
- `current.key_money_recovery` — 권리금 회수 예상액

`engine/rule_engine.py`의 `net_deposit_change`와 가용현금 합산 로직도 함께 손봐야 합니다.

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
