"""공통 피처 정의 + 데이터 로드/분할. v1/v2/v3 가 모두 이걸 씀."""
from __future__ import annotations

import os
from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split

DATA_CSV = Path(__file__).parent / "data" / "sanggwon_synth.csv"

# 예측에 쓰고 '싶은' 피처 후보. 실제로 데이터에 있는 것만 자동 선택됨.
#  (합성=전부 있음 / 서울 실데이터=rent·signgu 없음 → 자동 제외)
NUM_CANDIDATES = ["flow_pop", "work_pop", "resident_pop", "store_cnt",
                  "open_rate", "close_rate", "competitor_cnt", "rent",
                  "prev_sales", "yoy_sales"]          # prev/yoy = 실데이터 전용(시계열)
CAT_CANDIDATES = ["signgu", "svc_induty", "change_idx", "season"]

TARGET_SALES = "monthly_sales"     # 회귀
TARGET_SURVIVE = "survived_2y"     # 분류


REAL_CSV = Path(__file__).parent / "data" / "sanggwon_real.csv"


def load_data() -> pd.DataFrame:
    """데이터 로드.
    ML_REAL=1 → 서울 실데이터(자치구×업종×분기). 아니면 합성 데이터."""
    if os.getenv("ML_REAL") == "1":
        if not REAL_CSV.exists():
            from data.real_loader import build_real  # noqa
            build_real().to_csv(REAL_CSV, index=False, encoding="utf-8")
        return pd.read_csv(REAL_CSV)
    if not DATA_CSV.exists():
        from data.synth import generate  # noqa
        DATA_CSV.parent.mkdir(parents=True, exist_ok=True)
        generate().to_csv(DATA_CSV, index=False, encoding="utf-8")
    return pd.read_csv(DATA_CSV)


def feature_cols(df: pd.DataFrame):
    """데이터프레임에 실제로 존재하는 피처만 반환 (rent/signgu 결측 자동 대응)."""
    num = [c for c in NUM_CANDIDATES if c in df.columns]
    cat = [c for c in CAT_CANDIDATES if c in df.columns]
    return num, cat


# 하위호환: 일부 스크립트가 참조하는 전역
NUM_FEATURES = NUM_CANDIDATES
CAT_FEATURES = CAT_CANDIDATES
FEATURES = NUM_CANDIDATES + CAT_CANDIDATES


def split_xy(df: pd.DataFrame, target: str):
    df = df.dropna(subset=[target])
    num, cat = feature_cols(df)
    X = df[num + cat].copy()
    y = df[target].copy()
    strat = y if (target == TARGET_SURVIVE and y.nunique() > 1) else None
    return train_test_split(X, y, test_size=0.2, random_state=42, stratify=strat)


ARTIFACT_DIR = Path(__file__).parent / "artifacts"
ARTIFACT_DIR.mkdir(exist_ok=True)
