# Stay or Move

서울 소상공인의 현재 매장과 후보 매장을 지도에서 비교하고, 현재 손익·후보 계약조건·서울시 상권 데이터를 결합해 이전 경제성 조건을 보여주는 MVP입니다.

## 현재 구조

- NAVER Web Dynamic Map: 지도 표시, 현재 + 후보 A/B/C 마커
- NAVER Geocoding: 도로명 주소 → 좌표 (키가 없으면 제공된 데모 주소 4곳은 로컬 좌표로 폴백)
- 서울시 영역-상권 GeoJSON: 좌표 → `TRDAR_CD` + 상권 경계
- SQLite `data/seoul_market.sqlite`: 추정매출 YoY, 폐업률, 상권변화지표 빠른 조회
- Rule Engine: 필요 매출 유지율, 목표 회수기간별 필요매출, 회수기간, 초기 이전자금
- OpenAI: 선택사항. 키가 없으면 규칙 기반 문장으로 데모 동작

## 1. 환경변수

```bash
cp .env.example .env
```

`.env`에서 NAVER만 입력하면 지도/주소검색을 사용할 수 있습니다.

```env
DEMO_MODE=true
VITE_DEMO_MODE=true
NCP_APIGW_KEY_ID=YOUR_CLIENT_ID
NCP_APIGW_KEY=YOUR_CLIENT_SECRET
VITE_NCP_MAP_KEY_ID=YOUR_CLIENT_ID
```

NAVER Cloud Application에서 다음을 확인합니다.

- Web Dynamic Map 활성화
- Geocoding 활성화 (주소 검색용)
- Web 서비스 URL: `http://localhost` (포트 번호 제외)

`.env`를 수정한 뒤에는 Vite 개발 서버를 반드시 재시작해야 합니다.

## 2. 실행

백엔드:

```bash
python -m pip install -r requirements.txt
uvicorn api.main:app --reload --port 8001
```

프론트:

```bash
cd web
npm install
npm run dev
```

브라우저: `http://localhost:5173`

## 3. API 키 없이 데모

상단 `데모 불러오기`를 누르면 미리 정의된 4개 위치와 계약조건을 불러옵니다.

- 서울시 Open API 키: 필요 없음 (로컬 DB 사용)
- OpenAI API 키: 필요 없음 (rule-based demo 설명)
- NAVER Geocoding 키: 데모 주소 4곳은 없어도 좌표 폴백 가능
- NAVER Web Dynamic Map Client ID: 실제 네이버 지도를 화면에 띄우려면 필요

지도에서 위치 항목을 먼저 선택한 뒤 직접 클릭하면, Geocoding 없이도 좌표 → 서울시 상권코드/경계를 지정할 수 있습니다.

## 4. 데이터 흐름

```text
주소 검색 ──NAVER Geocoding──> 좌표
                               │
지도 클릭 ─────────────────────┘
                               ↓
                      서울시 영역-상권 GeoJSON
                               ↓
                           TRDAR_CD
                               ↓
                       seoul_market.sqlite
                        ↙        ↓        ↘
                   매출 YoY    폐업률    상권변화
                               +
                    현재손익 / 후보계약조건
                               ↓
                         Rule Engine
                               ↓
                           Dashboard
```

## 5. 핵심 엔드포인트

- `GET /health`
- `GET /demo-locations`
- `POST /commercial-area` — 주소 → 좌표 → 상권
- `POST /commercial-area/by-point` — 지도 클릭 좌표 → 상권
- `POST /market-context` — 상권코드 + 업종 → 서울시 지표
- `POST /staymove` — 경제성 계산

