# Stay or Move — Final Merge MVP

최종 기획안 기준으로 기존 Figma형 화면/Rule Engine 프로젝트와 정책금융 RAG 프로젝트를 합친 버전입니다.

## 핵심 사용자 흐름

첫 질문은 사용자가 `자발적/비자발적`이라는 용어를 고르게 하지 않습니다.

> 현재 매장에서 계속 영업할 수 있나요?

- YES → **자발적 이전** → `현재 점포 Stay vs 후보지 Move`
- NO → **비자발적 이전** → `후보 A vs 후보 B vs 후보 C`
  - 현재 점포는 선택지가 아니라 기존 영업실적의 기준점으로만 사용

## 통합된 계산/검색 흐름

```text
사용자 입력
  ↓
Rule Engine
  ├─ 최소 필요 월매출
  ├─ 필요 매출 유지율
  ├─ 실제 이전비용
  ├─ 초기 이전 소요자금
  └─ 추가 필요 이전자금
        ↓
후보 주소 → 서울 자치구
        ↓
정책금융 RAG
  ├─ 해당 자치구
  ├─ 서울 공통
  └─ 전국 공통
        ↓
Dashboard / 조건부 판단 근거
```

정책금융은 `추가 필요 이전자금`에서 지원한도를 자동 차감하지 않습니다. 검색된 정책은 실제 승인/지원 확정을 의미하지 않습니다.

## 금액 단위

프론트/Rule Engine 입력은 **만원**입니다.

RAG에 전달할 때만:

```python
additional_fund_needed_krw = additional_fund_needed * 10_000
```

으로 원 단위로 변환합니다.

## 주요 변경점

- 온보딩: 자발/비자발 이전 분기
- 자발적: Stay vs Move 프레이밍
- 비자발적: Move vs Move 프레이밍
- 현재 입력에 `보유 가용현금` 추가
- 후보 입력에 `원상회복비`, `권리금`, `기타 이전비`, `목표 회수기간` 추가
- 실제 이전비 공식: 인테리어 + 이사 + 원상회복 + 권리금 + 기타 + 휴업손실
- 추가 필요 이전자금 계산 후 정책 RAG에 전달
- 기존 607-vector FAISS 정책 DB 포함
- 결과 화면에 정책금융 섹션 추가

## 프로젝트 구조

```text
Stay_or_Move_merged/
├── api/
├── engine/
├── geo/
├── data_sources/
├── data/
├── policy_rag/
│   ├── src/
│   │   ├── retrieve.py
│   │   └── ...
│   ├── vector_db/
│   │   ├── policy.index
│   │   └── metadata.json
│   └── data/
├── web/
├── staymove.py
├── integration_test.py
└── requirements.txt
```

## 1. Python 설치

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`sentence-transformers` 모델은 첫 RAG 실행 시 Hugging Face에서 다운로드될 수 있습니다.

## 2. 터미널 통합 확인

Rule Engine 연결만 빠르게 확인:

```bash
python3 integration_test.py --no-rag
```

Rule Engine + 실제 정책 RAG까지 확인:

```bash
python3 integration_test.py
```

이 테스트는 두 경우를 모두 출력합니다.

- A. 자발적 이전: Stay vs Move
- B. 비자발적 이전: Move vs Move

## 3. 백엔드 실행

```bash
uvicorn api.main:app --reload --port 8001
```

`POST /staymove`는 기본적으로 Rule Engine + RAG를 실행합니다.

RAG 없이 Rule만 빠르게 확인하려면:

```text
POST /staymove?explain=false&use_rag=false
```

## 4. 프론트 실행

```bash
cd web
npm install
npm run dev
```

브라우저: `http://localhost:5173`

기존 화면의 디자인 언어를 유지하면서 첫 온보딩과 정책금융 결과 섹션만 추가했습니다.

## 환경변수

```bash
cp .env.example .env
```

NAVER 지도/주소 검색은 기존 환경변수를 그대로 사용합니다. OpenAI는 선택사항입니다. 정책 RAG 검색 자체는 OpenAI API를 사용하지 않습니다.
