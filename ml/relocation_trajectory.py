"""
이전 시 매출 추이(회복 곡선) 프로젝션.
- 개념: 매장을 옮기면 매출이 곧바로 정상화되지 않고, 초기에 떨어졌다가 몇 개월에 걸쳐 회복한다.
  이 회복 곡선을 파라미터 모델로 표현해, 이전 후 월별 예상 매출 궤적을 제공한다.
- 모델:  sales(t) = steady * (1 - (1 - r0) * exp(-t / tau))
    r0   : 이전 첫 달 매출 비율(정상 대비, 예 0.7)
    tau  : 회복 시간상수(작을수록 빨리 회복)
    steady : ML v2가 예측한 '정상 상태' 월매출(만원)
- 실데이터가 쌓이면 fit_recovery()로 r0/tau를 실측 궤적에서 추정해 교체.
실행: python relocation_trajectory.py
"""
from __future__ import annotations

import numpy as np


def project(steady_sales: float, months: int = 12, r0: float = 0.70,
            tau: float = 3.0) -> list[dict]:
    """이전 후 월별 예상 매출 궤적."""
    out = []
    for t in range(months):
        ratio = 1 - (1 - r0) * np.exp(-t / tau)
        out.append({"month": t + 1, "ratio": round(ratio, 3),
                    "sales": round(steady_sales * ratio)})
    return out


def fit_recovery(observed_ratio_by_month: dict[int, float]) -> dict:
    """실측 궤적(월→정상대비비율)에서 r0, tau 추정. scipy 있으면 곡선적합, 없으면 근사."""
    months = np.array(sorted(observed_ratio_by_month))
    ratios = np.array([observed_ratio_by_month[m] for m in months], dtype=float)
    try:
        from scipy.optimize import curve_fit
        f = lambda t, r0, tau: 1 - (1 - r0) * np.exp(-t / tau)
        (r0, tau), _ = curve_fit(f, months - 1, ratios, p0=[0.7, 3.0],
                                 bounds=([0.3, 0.5], [1.0, 12.0]), maxfev=5000)
        return {"r0": round(float(r0), 3), "tau": round(float(tau), 2), "method": "curve_fit"}
    except Exception:
        r0 = float(ratios[0])
        # 정상(0.98) 도달 시점으로 tau 근사
        reach = months[np.argmax(ratios >= 0.98)] if (ratios >= 0.98).any() else months[-1]
        tau = max(0.5, reach / 3.0)
        return {"r0": round(r0, 3), "tau": round(tau, 2), "method": "approx"}


def main():
    steady = 2450  # 예: ML v2가 예측한 정상 월매출(만원)
    traj = project(steady, months=12)
    print("=" * 56)
    print(f"이전 시 매출 추이 (정상 {steady:,}만원 기준)")
    print("=" * 56)
    for r in traj:
        bar = "█" * int(r["ratio"] * 30)
        print(f"  {r['month']:>2}개월  {r['sales']:>6,}만원  ({r['ratio']*100:4.0f}%) {bar}")
    # fit 데모
    fit = fit_recovery({1: 0.70, 2: 0.80, 3: 0.88, 4: 0.93, 6: 0.98})
    print("\n[실측 궤적에서 회복 파라미터 추정 데모]", fit)


if __name__ == "__main__":
    main()
