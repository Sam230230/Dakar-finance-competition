# ML 모듈 — 매출 예측 · 폐업 확률 · 상권 추이

Stay/Move 규칙엔진에 **데이터 기반 예측**을 공급하는 ML 계층.
지금은 서울 상권 스키마와 동일한 **합성 데이터**로 학습되며(`data/synth.py`),
실데이터가 준비되면 그 CSV만 교체하면 코드는 그대로 동작한다.

## 구성

| 파일 | 역할 | 모델 |
|---|---|---|
| `data/synth.py` | 서울 상권 형태 합성 데이터 생성 (실데이터 교체 지점) | — |
| `features.py` | 공통 피처/로드/분할 | — |
| `v1_sales_linear.py` | **ML v1** 후보 월매출 예측(투명 베이스라인) | Linear Regression |
| `v2_sales_gbm.py` | **ML v2** 매출 예측 고도화 + SHAP 근거 | LightGBM (→ HistGBM 폴백) |
| `v3_closure_clf.py` | **ML v3** 폐업/생존 확률 | LightGBM 분류 |
| `retention_trend.py` | **지역별 매출 유지율 추이** (자치구·분기 YoY·추세) | 집계·추세 |
| `relocation_trajectory.py` | **이전 시 매출 추이** (회복 곡선 프로젝션) | 파라미터 모델 |
| `predict.py` | 통합 추론(후보 1곳 → 예측매출·폐업확률·궤적) | — |
| `train_all.py` | 전체 학습·평가 한 번에 | — |

## 실행

```bash
cd ml
pip install -r requirements.txt
python train_all.py            # 합성 데이터로 학습
ML_REAL=1 python train_all.py  # 서울 실데이터(자치구×업종×분기)로 학습
python predict.py              # 후보 1곳 통합 예측 데모
python relocation_trajectory.py
```

`ML_REAL=1` 이면 `data/real_loader.py` 가 `data/real_data/서울시 상권분석서비스(추정매출-자치구).json`
(21분기·25자치구·63업종)을 학습 테이블로 변환해 `data/sanggwon_real.csv` 에 캐시한다.
피처는 누출 없는 시계열 형태만 사용: `prev_sales`(직전분기), `yoy_sales`(전년동기), `season`.

## 현재 성능

| 모델 | 합성 데이터 | 서울 실데이터 (ML_REAL=1) |
|---|---|---|
| v1 매출(선형) | R² 0.88 · MAE 181만 | R² 0.98 · MAE 약 16억(평균 대비 ~10%) |
| v2 매출(GBM) | R² 0.88 | R² 0.97 |
| v3 폐업(분류) | AUC 0.64 · F1 0.84 | AUC 0.90 · F1 0.94 (프록시 라벨) |
| 유지율 추이 | 자치구별 분기 성장률·상승/보합/하락 라벨 | 〃 (용산·관악 하락, 동대문·중구 상승) |

> 실데이터는 grain이 **자치구 단위 매출 합계**라 금액 스케일이 합성(점포 단위)과 다르다.
> `survived_2y` 는 실제 폐업이 아니라 '8분기 뒤 매출이 절반 미만으로 감소' 프록시 라벨.
> 상권단위 유동/직장/상주인구 CSV는 자치구 crosswalk가 없어 아직 미결합(`real_loader.py` 주석 참조).

## Stay/Move 와의 연결 (다음 단계)

`predict.predict_site()`가 주는 **예상 월매출**을 규칙엔진의 '유지율 판정'에 넣으면,
사용자가 감으로 넣던 매출 유지율이 **데이터 기반 추정**으로 바뀐다.
**폐업 확률**은 결과 화면의 리스크 경고로, **회복 궤적**은 회수기간 시나리오 보정에 사용.

## 원칙

- ML은 규칙엔진을 대체하지 않고 **입력으로** 들어간다(돈 계산은 여전히 규칙엔진).
- 예측은 항상 **추정치**로 표시(불확실성 동반).
- 실데이터 교체: `data/sanggwon_synth.csv` 를 동일 컬럼의 실제 상권 조인 테이블로 바꾸면 끝.

## 향후: 정부 보조금 LLM 결합

예측(매출·폐업확률·궤적) + 규칙엔진(손익) 결과를 컨텍스트로 넘겨,
"이 조건의 사업자가 받을 수 있는 정부/지자체 지원사업"을 찾는 LLM 에이전트를 붙이는 구조로 확장 예정.
