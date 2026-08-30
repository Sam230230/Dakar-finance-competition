"""전체 파이프라인: 데이터 준비 → v1/v2/v3 학습 → 추이 분석. 한 방에 실행.
실행: python train_all.py
"""
from features import load_data

print("데이터 준비...")
df = load_data()
print(f"  shape={df.shape}, 자치구 {df.signgu.nunique()}개, 업종 {df.svc_induty.nunique()}개\n")

import v1_sales_linear, v2_sales_gbm, v3_closure_clf, retention_trend

r1 = v1_sales_linear.main(); print()
r2 = v2_sales_gbm.main(); print()
r3 = v3_closure_clf.main(); print()
retention_trend.main()

print("\n" + "=" * 56)
print("요약")
print("=" * 56)
print(f"v1 매출(선형)  R²={r1['r2']:.3f}  MAE={r1['mae']:,.0f}만")
print(f"v2 매출(GBM)   R²={r2['r2']:.3f}  MAE={r2['mae']:,.0f}만  [{r2['backend']}]")
print(f"v3 폐업(분류)  AUC={r3['auc']:.3f}  F1={r3['f1']:.3f}")
print("\n모델은 ml/artifacts/ 에 저장됨. 추론은 predict.py 참고.")
