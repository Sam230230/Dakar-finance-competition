# Integration Test Report

## 확인 완료

- Python syntax compile: PASS
- 최신 후보별 analysis_mode 로직: PASS
- CASE 1: A = growth_opportunity: PASS
- CASE 2: A = cost_recovery, 17개월: PASS
- CASE 3: A growth / B,C cost_recovery: PASS
- ML artifact inference: PASS
- FastAPI `/staymove?explain=false&use_rag=false&use_ml=true`: HTTP 200
- 두 번째 요청부터 ML cache 적용 확인: 약 0.01~0.03초 수준 (현재 테스트 환경 기준)

## 패키지에 적용한 지연 개선

- ML model/data `lru_cache`
- FAISS + SentenceTransformer `lru_cache`
- FastAPI startup warmup
- frontend geocoding 병렬 요청
- runtime에서 기업마당/PDF/embedding 재구축 금지
- A/B/C 최종 LLM 설명 1회 batch call
- performance timing 응답 포함

## 현재 실행환경에서 제한된 확인

이 실행환경에는 `faiss-cpu`가 설치되어 있지 않아 RAG runtime 실검색은 수행하지 못했습니다.
프로젝트 `requirements.txt`에는 `faiss-cpu`가 포함되어 있고, 기존 `policy.index` / `metadata.json`은 ZIP에 포함되어 있습니다.

또한 현재 환경은 외부 npm registry 접근이 제한되어 `npm install`을 완료하지 못했으므로 Vite production build는 여기서 재실행하지 못했습니다. `web/package.json` / `package-lock.json`은 포함되어 있습니다.

ML joblib은 scikit-learn 1.9.0에서 생성된 artifact이므로 프로젝트 requirements를 `scikit-learn==1.9.0`으로 고정했습니다.
