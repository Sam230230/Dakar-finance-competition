# 상권 이전 컨설팅 도우미

사업자가 **현재 사업지**와 **이전 후보 3곳**을 입력하면, 4명의 AI 컨설턴트(에이전트)가
순서대로 분석하여 **"어디로 옮기는 게 좋은지"를 자연어 상담 리포트**로 답합니다.

> Skala-career-helper(취업 컨설팅)의 CrewAI 4-에이전트 → FastAPI → React 구조를
> **'사업 이전지 추천'** 주제로 그대로 변환한 프로젝트입니다.
> (서울시 상권 데이터 연동은 이번 버전에서 제외 — LLM + 선택적 웹검색만으로 동작)

## 파이프라인 (4 에이전트 · 순차)

| 단계 | 에이전트 | 하는 일 | 출력(Pydantic) |
|---|---|---|---|
| 1 | **site_analyst** (현황 분석가) | 현재 사업·이전 사유 → 새 입지 필수 조건 도출 | `BusinessProfile` |
| 2 | **location_scout** (입지 분석가) | 후보 3곳을 동일 잣대로 분석 (선택적 웹검색) | `CandidateSitesReport` |
| 3 | **fit_evaluator** (적합도 평가관) | 배점표(35/30/20/15)로 채점·순위·추천 | `RelocationFitReview` |
| 4 | **consulting_reporter** (리포터) | 결과를 자연어 상담 리포트로 재구성 | 마크다운 리포트 |

각 단계는 앞 단계의 **구조화된 결과**를 context 로 받아 환각을 줄입니다.

## 입력 / 출력

**입력** (`/relocate` POST)
```json
{
  "business_name": "아무개 커피",
  "industry": "개인 카페 (체류형, 20~30대)",
  "current_site": "관악구 대학가 이면도로 2층, 25평",
  "relocation_reason": "재계약 시 임대료 30% 인상, 2층이라 가시성 낮음",
  "candidate_sites": [
    {"site_id": "A", "name": "성수동 카페거리 1층", "note": "임대료 높음, 권리금 있음"},
    {"site_id": "B", "name": "망원동 주택가 코너 1층", "note": "주차 어려움"},
    {"site_id": "C", "name": "여의도 오피스가 지하1층", "note": "주말 공동화 우려"}
  ],
  "priorities": "가시성 > 임대료 안정 > 평수",
  "budget": "보증금 5천 / 월세 250만 이내"
}
```

**출력** — 핵심은 `report_markdown`(자연어 상담 리포트). 부가로 단계별 구조화 결과 포함.

## 실행 방법

```bash
# 1) 백엔드
pip install -r requirements.txt
cp .env.example .env   # OPENAI_API_KEY 입력
python crew.py                                   # 목 데이터로 파이프라인 단독 실행
uvicorn api.main:app --reload --port 8001        # API 서버

# 2) 프론트엔드
cd web
npm install
npm run dev                                       # http://localhost:5173
```

## 폴더 구조
```
relocation_helper/
├─ config/
│  ├─ agents.yaml        # 4개 에이전트 역할/규칙
│  └─ tasks.yaml         # 단계별 프롬프트(배점표·준수규칙·근거인용)
├─ crew.py               # Pydantic 입출력 스키마 + CrewBase 오케스트레이션
├─ engine/
│  ├─ rule_engine.py     # STEP4 경제성 계산(CVP·회수기간). LLM 관여 X, 순수 파이썬
│  └─ test_rule_engine.py# 검산·엣지케이스 테스트
├─ geo/
│  └─ naver_geocode.py   # 주소→좌표 (NCP Geocoding REST)
├─ data_sources/
│  └─ sosangong.py       # 소진공 상가정보(반경 경쟁점포/상권밖 폴백)
├─ api/
│  └─ main.py            # FastAPI (/health, /relocate, /geocode, /competitors)
├─ web/                  # React + Vite 프론트엔드
│  └─ src/{main.jsx, App.jsx, MapView.jsx, naverMap.js}
├─ output/
├─ requirements.txt
├─ .env.example
└─ README.md
```

## 엔드포인트 요약
| 메서드 | 경로 | 역할 |
|---|---|---|
| POST | /geocode | 주소 목록 → 좌표(네이버) |
| POST | /competitors | 좌표 반경 내 (동종)업소 조회(소진공) |
| POST | /staymove | **핵심**: 후보별 손익·회수 계산 + 순위 + AI 자연어 설명 (explain=false 면 계산만) |
| POST | /trend | 좌표 → 상권코드 조인 → 서울시 상권변화지표(정형 등급) 조회. 젠트리피케이션 관련 '근거' — 예측·점수화 없음. 폴리곤 GeoJSON+API키 미설정 시 `available:false`로 정직하게 응답 |
| POST | /relocate | (구버전) CrewAI 4-에이전트 자연어 리포트 |

## 결과 지도 (추천지 강조)
`web/src/MapView.jsx` 는 결과 화면에서 `recommendedId` 로 추천 후보를 👑·노란 테두리로
강조하고, `competitors`(소진공 반경 경쟁점포)를 회색 점으로 표시합니다.
```jsx
<MapView current={cur} candidates={cands}
         recommendedId="A" competitors={comp} radii={[300,500]} />
```

## 데이터 흐름(합쳐진 최종 형태)
```
주소 ─/geocode→ 좌표 ─/competitors→ 반경 경쟁수(근거)
CSV·계약조건 ─ rule_engine → Stay/Move 숫자(확정 계산)
        └→ CrewAI consulting_reporter 가 숫자+근거를 자연어로 설명
        └→ 결과 화면 지도에 추천지 강조 표시
```

## 상권변화지표(젠트리피케이션 근거) — 설계 원칙
`geo/sanggwon_join.py`(좌표→상권코드 공간조인)와 `data_sources/sanggwon_trend.py`(상권코드→
서울시 상권변화지표 조회)를 연결해 `/trend` 엔드포인트로 노출한다.

- 웹 스크래핑이나 LLM 추정으로 "이 동네 젠트리피케이션 가능성"을 새로 만들지 않는다.
- 서울시가 이미 정형 데이터로 분류해 둔 등급(HH/HL/LH/LL — 생존율×폐업율 2x2)만 그대로 인용한다.
- `explainer` 에이전트는 이 등급을 '설명'만 하고, 여기서 새로운 위험도 점수나 미래 예측을 만들지 않는다.
- `data/sanggwon.geojson`(서울시 영역-상권 SHP→GeoJSON 변환본)과 `SEOUL_OPENAPI_KEY`가 없으면
  `/trend`는 500 대신 `available:false`로 정직하게 응답한다(전체 파이프라인을 막지 않음).
- 실제 오퍼레이션명(`SANGGWON_TREND_OPERATION`)과 등급 필드명은 배포 전 서울 열린데이터광장
  OA-15576 스펙으로 최종 확인 필요(코드 내 주석 참고).

## 다음 단계 (선택)
- `data/sanggwon.geojson` 확보 + `/trend`를 프론트 결과 화면의 상권 근거 카드에 연결.
- rule_engine 출력을 CrewAI `consulting_reporter` context 로 연결(숫자→자연어).
