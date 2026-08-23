# 서울시 상권 데이터

이 폴더의 `sanggwon.geojson`과 `seoul_market.sqlite`는 사용자가 제공한 서울시 상권분석 원본을 MVP용으로 전처리한 결과입니다.

## 서비스에서 사용하는 방식

사용자 주소
→ NAVER Geocoding API로 좌표 변환
→ `sanggwon.geojson`에서 서울시 상권코드(TRDAR_CD) 확인
→ `seoul_market.sqlite`에서 업종별 상권 근거 조회
→ 대시보드 표시

서비스 실행 중 서울시 Open API를 매번 호출하지 않습니다.

## 포함 데이터

- `sanggwon.geojson`
  - 서울시 영역-상권 SHP를 EPSG:4326으로 변환
  - 주소 좌표 → 상권코드 및 실제 상권 경계 표시
- `seoul_market.sqlite`
  - 추정매출: 2025 Q4와 2024 Q4를 비교해 YoY 계산
  - 점포/폐업률: 제공받은 점포 데이터의 2024 Q4
  - 상권변화지표: 제공받은 파일의 최신 2026 Q1

주의: 원본 파일별 최신 시점이 서로 다르므로 화면에서도 기준 분기를 별도로 표시합니다.
