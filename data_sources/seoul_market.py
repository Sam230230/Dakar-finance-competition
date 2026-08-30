"""Preprocessed Seoul commercial-area context stored in local SQLite.

The database is generated from Seoul Open Data files (sales, stores, commercial-area change index)
so user requests do not call the Seoul API repeatedly.
"""
from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass, asdict
from typing import Optional, List

DEFAULT_DB = os.getenv("SEOUL_MARKET_DB", "data/seoul_market.sqlite")


@dataclass
class MarketMetric:
    trdar_cd: str
    trdar_nm: str
    industry_cd: str
    industry_nm: str
    sales_period: Optional[int]
    sales_yoy: Optional[float]
    sales_amt_current: Optional[float]
    store_period: Optional[int]
    closure_rate: Optional[float]
    open_rate: Optional[float]
    store_count: Optional[int]
    franchise_count: Optional[int]
    change_period: Optional[int]
    change_index: Optional[str]
    change_name: Optional[str]
    avg_open_months: Optional[float]
    avg_closed_months: Optional[float]

    def to_dict(self):
        d = asdict(self)
        if d["sales_yoy"] is not None:
            d["sales_yoy"] = round(float(d["sales_yoy"]), 1)
        return d


def _connect(path: str = DEFAULT_DB):
    if not os.path.exists(path):
        raise FileNotFoundError(f"서울시 전처리 DB가 없습니다: {path}")
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    return con


def lookup_metric(trdar_cd: str, industry_cd: str = "CS100010", path: str = DEFAULT_DB) -> Optional[MarketMetric]:
    con = _connect(path)
    try:
        row = con.execute(
            """
            SELECT trdar_cd, trdar_nm, industry_cd, industry_nm,
                   sales_period, sales_yoy, sales_amt_current,
                   store_period, closure_rate, open_rate, store_count, franchise_count,
                   change_period, change_index, change_name, avg_open_months, avg_closed_months
              FROM market_metrics
             WHERE trdar_cd = ? AND industry_cd = ?
             LIMIT 1
            """,
            (str(trdar_cd), industry_cd),
        ).fetchone()
        if not row:
            return None
        return MarketMetric(**dict(row))
    finally:
        con.close()


def district_totals(trdar_codes: List[str], industry_cd: str = "CS100010", path: str = DEFAULT_DB) -> dict:
    """Sum sales_amt_current/store_count across a set of TRDAR codes (one district's
    commercial areas, from the TRDAR->district crosswalk) for one industry — this is the
    real single-quarter (2025Q4 sales / 2024Q4 stores) snapshot used to convert a district-level
    time-series sales forecast into a specific commercial area's share, without fabricating a
    TRDAR-level time series that doesn't exist in the source data."""
    if not trdar_codes:
        return {"total_sales_amt": 0.0, "total_store_count": 0.0, "n_trdar_with_data": 0}
    con = _connect(path)
    try:
        placeholders = ",".join("?" for _ in trdar_codes)
        row = con.execute(
            f"""
            SELECT COALESCE(SUM(sales_amt_current), 0) AS total_sales_amt,
                   COALESCE(SUM(store_count), 0) AS total_store_count,
                   COUNT(*) AS n_trdar_with_data
              FROM market_metrics
             WHERE industry_cd = ? AND trdar_cd IN ({placeholders})
            """,
            (industry_cd, *[str(c) for c in trdar_codes]),
        ).fetchone()
        return dict(row)
    finally:
        con.close()


def per_store_sales_values(industry_cd: str = "CS100010", path: str = DEFAULT_DB) -> List[float]:
    """모든 TRDAR의 (sales_amt_current / store_count) 실측 분포 — 만원 단위.
    특정 예측이 정상 범위 밖인지 판단하는 sanity-check 기준선으로 쓴다(모델 산출물이 아니라
    실측 스냅샷 그 자체의 분포이므로, 이 분포 안에 있다면 pipeline이 만들어낸 왜곡이 아니라
    실제로 그 정도로 매출 밀도가 높은/낮은 상권이 존재한다는 뜻이다)."""
    con = _connect(path)
    try:
        rows = con.execute(
            "SELECT sales_amt_current, store_count FROM market_metrics "
            "WHERE industry_cd = ? AND store_count > 0 AND sales_amt_current IS NOT NULL",
            (industry_cd,),
        ).fetchall()
        return [row["sales_amt_current"] / row["store_count"] / 10_000.0 for row in rows]  # 원->만원
    finally:
        con.close()


def list_industries(path: str = DEFAULT_DB) -> List[dict]:
    con = _connect(path)
    try:
        rows = con.execute("SELECT industry_cd, industry_nm FROM industries ORDER BY industry_cd").fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()
