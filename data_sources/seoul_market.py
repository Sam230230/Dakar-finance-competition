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


def list_industries(path: str = DEFAULT_DB) -> List[dict]:
    con = _connect(path)
    try:
        rows = con.execute("SELECT industry_cd, industry_nm FROM industries ORDER BY industry_cd").fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()
