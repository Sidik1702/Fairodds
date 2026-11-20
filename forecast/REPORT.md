# FairOdds Forecast Engine v1 — Backtest Report

**Date:** 2026-11-20 · **Code:** `engine.py` (forecaster), `backtest.py` (this report's
source), `slate.py` (daily slate generator) · **Raw results:** `results.json`

## What the engine does

For the question *"Will ASSET close above $X in 24h?"* the engine works entirely
in log-ratio space. It describes the current price path with six features
(trailing log-returns over 6/24/72/168h and realized vol over 24/168h), finds
historical moments whose paths looked similar ("comparables"), and takes the
Gaussian-kernel-weighted empirical distribution of those moments' realized
forward 24h log-returns. The probability is that distribution's mass above
`log(strike/spot)`, shrunk toward the unconditional base rate with a
pseudo-count weight tied to the kernel's effective sample size, and clipped to
[0.01, 0.99]. This is Gio's make.fun kernel-weighted log-ratio forecaster
(GTA CCU: LOO 0.186 vs 0.283 house) retargeted from audience forecasting to
price thresholds. Pure Python stdlib.

## Backtest protocol (no look-ahead)

- **Data:** real hourly closes, Coinbase Exchange public API — **180 days,
  4,320 closes per asset**, ending 2026-11-20. SOL $85.55 → $68.68,
  BTC $76,591 → $59,364 (note: a **downtrend window** — see Limitations).
- **Walk-forward:** 3-week burn-in seeds the comparables pool; forecast origins
  every 6h thereafter. At origin t the pool contains only origins whose 24h
  forward return was fully realized by t — the same information set as live.
- **Questions:** strikes = spot × {0.95, 0.975, 1.00, 1.025, 1.05} at every
  origin → **6,320 forecasts** (3,160 per asset).

## Results — Brier score (lower is better)

| Forecaster | Overall | SOL | BTC |
|---|---|---|---|
| **FairOdds kernel model** | **0.1073** | **0.1262** | **0.0884** |
| Naive momentum (Normal, drift = trailing 24h return) | 0.1464 | 0.1726 | 0.1201 |
| Unconditional base rate (pool frequency) | 0.1057 | 0.1244 | 0.0870 |
| Coin flip (flat 50%) | 0.2500 | 0.2500 | 0.2500 |

- vs the **coin-flip baseline (0.25)**: the model cuts Brier by **57%**.
- vs **naive momentum**: the model is **27% better** overall (0.1073 vs 0.1464)
  and better at **every strike** (below). Momentum is also badly calibrated —
  it says 2.6% and realizes 8.8%; it says 97.5% and realizes 90.3%.
- vs the **base rate**: see the honest finding below.

By strike (both assets pooled, n = 1,264 each):

| Strike × spot | Realized YES rate | Model | Momentum | Base rate |
|---|---|---|---|---|
| 0.950 | 0.978 | 0.0229 | 0.0368 | 0.0227 |
| 0.975 | 0.873 | 0.1149 | 0.1630 | 0.1142 |
| 1.000 | 0.502 | 0.2600 | 0.3478 | 0.2531 |
| 1.025 | 0.113 | 0.1001 | 0.1308 | 0.0996 |
| 1.050 | 0.040 | 0.0388 | 0.0535 | 0.0389 |

## Calibration — model, predicted vs realized

| Bucket | n | Mean predicted | Realized freq |
|---|---|---|---|
| 0.0–0.1 | 1,916 | 0.040 | 0.052 |
| 0.1–0.2 | 454 | 0.137 | 0.128 |
| 0.2–0.3 | 116 | 0.248 | 0.310 |
| 0.3–0.4 | 112 | 0.352 | 0.438 |
| 0.4–0.5 | 490 | 0.469 | 0.498 |
| 0.5–0.6 | 647 | 0.536 | 0.509 |
| 0.6–0.7 | 99 | 0.649 | 0.596 |
| 0.7–0.8 | 145 | 0.758 | 0.779 |
| 0.8–0.9 | 712 | 0.855 | 0.858 |
| 0.9–1.0 | 1,629 | 0.962 | 0.963 |

The high-mass buckets (the ±5% and ±2.5% strikes) are calibrated to within
~0.01. The mid buckets (0.2–0.4, small n) under-predict by up to ~0.09 — the
model is somewhat too pessimistic on downside strikes in this sample.

## The honest finding: we tie the base rate in this window

The kernel model (0.1073) does **not** beat the unconditional base rate
(0.1057) on this sample — it trails by 0.0016, i.e. a tie within noise. Why:
the 180-day window is one persistent downtrend regime for both assets, so the
unconditional frequencies at off-spot strikes were already extremely
informative, and the model's shrinkage target *is* that base rate — by design
the model can only deviate from it as far as the comparables' effective sample
size justifies. In this sample the conditioning delta was ≈ neutral. What the
engine demonstrably adds over the baselines that matter for seeding:

1. It crushes the flat-50% seed a default pm-AMM binary would open at
   (0.25 → 0.107), and beats the obvious "trend-continuation" heuristic by 27%.
2. It is *calibrated* where momentum is overconfident — a seed price that
   claims 97.5% for an event that happens 90% of the time is exactly how LPs
   get picked off; the model's extreme buckets are accurate to ~0.01.
3. At-the-money (strike = spot) is near a coin flip for *everyone*
   (0.253–0.260 for base rate and model; momentum 0.348) — 24h direction at
   ATM is close to a random walk, and the report says so rather than hiding it.

Demonstrating a conditioning edge over the base rate needs a multi-regime
sample (see Limitations); v1's claim is narrower and defensible: **fair,
calibrated seeds, far better than 50% or momentum, never worse than the base
rate by more than noise.**

## Slate generator — live check

`slate.py` run against live prices (2026-11-20) proposed 6 markets, e.g.
SOL spot $68.52 → strikes $67.00 (p 0.754), $68.50 (p 0.490), $69.00 (p 0.293);
BTC spot $59,255 → $58,050 (p 0.816), $58,650 (p 0.679), $59,250 (p 0.336) —
each emitted with `initial_price_bps` for the pm-AMM custom-seed flow.
Kernel effective sample sizes were low (ESS 13–23 on 45 days of history), so
live seeds lean heavily on the base-rate shrinkage — conservative by design;
ESS grows with the history window.

## Limitations

- **One regime.** 180 days, both assets trending down ~20%. No bull/sideways
  regime in sample; the conditioning edge (or lack of it) may differ there.
- **Correlated test points.** Origins every 6h with a 24h horizon overlap, so
  the 6,320 forecasts are not independent — effective sample size is much
  smaller and Brier differences of ~0.002 (model vs base rate) are not
  significant.
- **Two assets, one venue.** Coinbase hourly closes; resolution will use Pyth,
  whose price can differ slightly from any single venue's close.
- **Fixed hyperparameters.** Kernel bandwidth (1.1) and shrinkage (k = 30) were
  set a priori, *not* tuned on this backtest — honest, but leaves performance
  on the table. Any tuning must happen on a separate fold.
- **No market frictions modeled.** The backtest grades probability quality
  only; it says nothing about LP P&L after pm-AMM fees/LVR (that is the
  pm-AMM's uniform-LVR design question, not the forecaster's).

## Next steps

1. Extend history to 2+ years (multi-regime) and re-run; report per-regime
   Brier so the conditioning delta is measured where regimes actually change.
2. Validate bandwidth/lookbacks on a held-out fold before touching the defaults.
3. Track per-category Brier (asset × strike band) live, matching the
   ForecastRegistry track-record design in `docs/ARCHITECTURE.md` §5.

## Reproduce

```sh
cd forecast/
python3 backtest.py   # fetches+caches data, writes results.json, prints tables
python3 slate.py      # writes slate.json with today's proposed markets
```
