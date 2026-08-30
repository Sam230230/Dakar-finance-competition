# Stay or Move — Web Final Integration

이 ZIP은 다음을 한 프로젝트로 합친 로컬 실행용 웹 버전입니다.

- 최종 온보딩 웹 흐름
- Rule Engine
- `ML_branch`의 원본 ML 코드/데이터/학습 artifact
- 서울 상권 데이터 연결
- 정책금융 RAG + FAISS index
- 후보 A/B/C별 결과 화면
- 선택적 LLM 설명

## 최종 온보딩 흐름

사용자에게 `자발적/비자발적`을 묻지 않습니다.

```text
현재 주소
→ 월평균 매출
→ 월 변동비
→ 월 고정비
→ 현재 보증금
→ 이전에 바로 쓸 수 있는 자기자금
→ 후보지 수 1~3곳
→ 후보 A/B/C 조건 입력
→ 현재 고정비 vs 후보 월 운영비 비교
→ cost_recovery 후보가 있으면 회수기간 1~36개월 질문
→ Rule + ML + RAG + AI 설명
```

후보별 내부 분석모드는 다음과 같습니다.

```text
후보 월 운영비 > 현재 월 고정비
→ growth_opportunity

후보 월 운영비 <= 현재 월 고정비
→ cost_recovery
```

UI에는 `자발적/비자발적`이라는 표현을 노출하지 않습니다.

최종 온보딩 원본 HTML은 `docs/final_onboarding_reference.html`에도 같이 넣었습니다.

## ML_branch 보존

`ml/` 아래의 기존 ML_branch 파일은 그대로 보존했습니다.

- `features.py`
- `v1_sales_linear.py`
- `v2_sales_gbm.py`
- `v3_closure_clf.py`
- `retention_trend.py`
- `relocation_trajectory.py`
- 원본 데이터
- 학습된 joblib artifact

서비스 연결만 위해 `ml/runtime.py`를 추가했습니다.

학습 artifact가 scikit-learn 1.9.0에서 생성되어 `requirements.txt`도 `scikit-learn==1.9.0`으로 맞췄습니다.

## API 지연 최소화

분석 요청 때마다 무거운 모델을 다시 로드하지 않습니다.

- ML joblib 모델: 프로세스당 1회 캐시
- ML CSV/추세 데이터: 1회 캐시
- FAISS index: 1회 캐시
- SentenceTransformer: 1회 캐시
- FastAPI 시작 시 warmup
- 주소 A/B/C geocoding: 프론트에서 병렬 요청
- 후보별 RAG는 로컬 FAISS만 검색
- 기업마당 API/PDF/embedding 구축은 `/staymove` runtime에서 실행하지 않음
- 최종 LLM 설명은 후보별 여러 번 호출하지 않고 A/B/C를 묶어 1회 호출

`.env`에서:

```env
WARMUP_MODELS=true
ENABLE_LLM_EXPLANATION=true
```

LLM 없이 Rule + ML + RAG 속도만 확인하려면:

```text
POST /staymove?explain=false&use_rag=true&use_ml=true
```

## 1. Python 실행

```bash
cd Stay_or_Move_WEB_FINAL
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn api.main:app --reload --port 8001
```

> macOS Apple Silicon에서 `faiss-cpu` 설치 문제가 있으면 Python 3.11 또는 3.12 가상환경을 권장합니다.

## 2. Web 실행

새 터미널:

```bash
cd Stay_or_Move_WEB_FINAL/web
npm install
npm run dev
```

브라우저:

```text
http://localhost:5173
```

## 3. 환경변수

`.env.example`을 복사해서 사용합니다.

핵심:

```env
NCP_APIGW_KEY_ID=
NCP_APIGW_KEY=
VITE_NCP_MAP_KEY_ID=
OPENAI_API_KEY=
OPENAI_MODEL_NAME=gpt-4o-mini
ENABLE_LLM_EXPLANATION=true
VITE_API_BASE=http://localhost:8001
WARMUP_MODELS=true
```

`OPENAI_API_KEY`가 비어 있으면 Rule + ML + RAG 결과는 그대로 나오고 AI 자연어 설명만 fallback으로 표시됩니다.

## 4. 통합 테스트

빠른 Rule + ML 테스트:

```bash
python integration_test.py --no-rag
```

RAG 포함 테스트:

```bash
python integration_test.py
```

LLM까지 포함하려면 OpenAI key 설정 후:

```bash
python integration_test.py --explain
```

테스트 케이스:

- A만 growth_opportunity
- A만 cost_recovery + 17개월
- A growth / B,C cost_recovery

## 주요 구조

```text
Stay_or_Move_WEB_FINAL/
├── api/
├── engine/                 # Rule Engine
├── ml/                     # ML_branch 원본 + runtime adapter
├── policy_rag/             # corpus / FAISS / retrieval
├── data/                   # 서울 상권 데이터
├── geo/
├── data_sources/
├── web/                    # React + Vite 최종 웹 UI
├── docs/
│   └── final_onboarding_reference.html
├── staymove.py             # Rule + ML + RAG + LLM orchestration
├── integration_test.py
├── requirements.txt
└── .env.example
```

## 주의

- 정책 RAG 결과는 지원 승인/수급 확정을 의미하지 않습니다.
- 정책 한도가 추가 필요자금보다 커도 `전액 충당 가능`으로 판단하지 않습니다.
- ML 결과는 추정치이며 Rule Engine 계산값을 대체하지 않습니다.
- 현재 매장은 후보 A/B/C 비교를 위한 baseline으로 유지됩니다.
