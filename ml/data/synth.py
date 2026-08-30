"""
서울 상권 스키마 형태의 '합성' 학습 데이터 생성기.

⚠️ 실데이터 교체 지점:
    실제로는 이 파일 대신 서울시 상권분석서비스(추정매출/유동인구/점포/상권변화지표)를
    상권코드(TRDAR_CD) + 기준년분기(STDR_YYQU_CD) 기준으로 조인한 테이블을 넣으면 된다.
    컬럼명을 아래 스키마와 맞추면 v1/v2/v3 학습 코드는 그대로 동작한다.

생성 컬럼(실데이터 대응):
    trdar_cd        상권코드 (TRDAR_CD)
    signgu          자치구
    stdr_yyqu       기준년분기 (예: 20241)
    svc_induty      서비스업종 (SVC_INDUTY_CD 명)
    flow_pop        길단위 유동인구
    work_pop        직장인구
    resident_pop    상주인구
    store_cnt       동종 점포수
    open_rate       개업률(%)
    close_rate      폐업률(%)
    competitor_cnt  반경 동종 경쟁 점포수(소진공)
    rent            임대료(만원/평, 추정)
    change_idx      상권변화지표 (LL/LH/HL/HH)
    monthly_sales   [타깃-회귀] 동종 월 추정매출(만원)
    survived_2y     [타깃-분류] 2년 생존 여부(1=생존)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

SIGUNGU = ["강남구", "마포구", "성동구", "영등포구", "관악구", "송파구", "종로구", "용산구",
           "서대문구", "광진구", "동작구", "은평구"]
INDUTY = ["커피-음료", "한식음식점", "분식전문점", "제과점", "치킨전문점", "의류"]
CHANGE = ["LL", "LH", "HL", "HH"]  # 상권변화지표
# 업종별 기본 매출 스케일(만원) — 현실감 위해 다르게
INDUTY_BASE = {"커피-음료": 2600, "한식음식점": 3400, "분식전문점": 1800,
               "제과점": 2400, "치킨전문점": 2100, "의류": 2000}
# 자치구별 상권 세기 배수
REGION_MULT = {g: m for g, m in zip(SIGUNGU, np.linspace(1.25, 0.8, len(SIGUNGU)))}
QUARTERS = [20231, 20232, 20233, 20234, 20241, 20242, 20243, 20244]


def generate(seed: int = 42, trdar_per_gu: int = 9) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for gu in SIGUNGU:
        for t in range(trdar_per_gu):
            trdar = f"{SIGUNGU.index(gu)+1:02d}{t:03d}"
            # 상권 고유 잠재 특성
            base_flow = rng.lognormal(9.2, 0.5)         # 유동인구 규모
            work_ratio = rng.uniform(0.2, 1.4)
            resid_ratio = rng.uniform(0.3, 1.2)
            rent0 = rng.uniform(8, 28) * REGION_MULT[gu]
            change = rng.choice(CHANGE, p=[0.25, 0.25, 0.25, 0.25])
            change_good = 1.0 if change in ("HL", "HH") else 0.0  # 생존기간 긴 쪽
            for gi, induty in enumerate(INDUTY):
                for qi, q in enumerate(QUARTERS):
                    quarter_trend = 1.0 + 0.015 * qi + rng.normal(0, 0.03)  # 완만한 성장+계절노이즈
                    flow = base_flow * rng.uniform(0.85, 1.15)
                    work = flow * work_ratio * rng.uniform(0.8, 1.2)
                    resid = flow * resid_ratio * rng.uniform(0.8, 1.2)
                    store_cnt = max(1, int(rng.poisson(6) * REGION_MULT[gu]))
                    competitor = max(0, int(rng.poisson(store_cnt * 0.6)))
                    open_rate = float(np.clip(rng.normal(8, 3), 1, 25))
                    close_rate = float(np.clip(rng.normal(7, 3) - 3 * change_good, 1, 25))
                    rent = float(np.clip(rent0 * rng.uniform(0.9, 1.1), 5, 40))

                    # ── 잠재 매출 공식(학습이 잡아낼 신호) ──
                    demand = (0.55 * flow + 0.30 * work + 0.15 * resid) / 1000.0
                    sales = (INDUTY_BASE[induty]
                             * (0.4 + 0.6 * demand / max(demand, 1))  # 정규화 안정화
                             * REGION_MULT[gu] * quarter_trend
                             * (1.0 - 0.015 * competitor)             # 경쟁 클수록 ↓
                             * (1.0 - 0.008 * (rent - 15)))           # 임대료 ↑면 약간 ↓
                    sales = float(max(300, sales + 0.35 * demand * 100 + rng.normal(0, 180)))

                    # ── 생존 확률(분류 타깃) ──
                    z = (-0.2
                         + 0.0009 * sales
                         - 0.12 * close_rate
                         - 0.05 * competitor
                         + 1.1 * change_good
                         + rng.normal(0, 0.4))
                    p_survive = 1 / (1 + np.exp(-z))
                    survived = int(rng.random() < p_survive)

                    rows.append(dict(
                        trdar_cd=trdar, signgu=gu, stdr_yyqu=q, svc_induty=induty,
                        flow_pop=int(flow), work_pop=int(work), resident_pop=int(resid),
                        store_cnt=store_cnt, open_rate=round(open_rate, 1),
                        close_rate=round(close_rate, 1), competitor_cnt=competitor,
                        rent=round(rent, 1), change_idx=change,
                        monthly_sales=round(sales), survived_2y=survived,
                    ))
    return pd.DataFrame(rows)


if __name__ == "__main__":
    from pathlib import Path
    df = generate()
    out = Path(__file__).with_name("sanggwon_synth.csv")
    df.to_csv(out, index=False, encoding="utf-8")
    print(f"생성 완료: {out}  shape={df.shape}")
    print(df.head())
    print("\n타깃 분포 — 매출(만원):", int(df.monthly_sales.mean()), "평균 /",
          "생존율:", f"{df.survived_2y.mean():.1%}")
