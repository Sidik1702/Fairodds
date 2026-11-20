# engine/ — forecast engine (off-chain)

Adapts Gio's proven forecasting stack from make.fun work to short-horizon crypto questions:

- **Kernel-weighted log-ratio forecaster** (GTA CCU forecast: LOO loss 0.186 vs house baseline 0.283).
- **Regression stack** — Huber IRLS regression + category-median multiples (token-radar: judge 91.4%).

v1 scope (build slot Nov 21): 24h SOL/BTC price-threshold questions only ("Will SOL close above $X in 24h?").

Outputs per proposed market:
- calibrated fair probability (→ becomes the pm-AMM market's `initialPriceBps` seed),
- confidence interval,
- market category (for per-category Brier tracking).

Also here: the market-slate generator (question templates, strikes set from spot ± bands) and the backtest/calibration report (Brier vs the 50%-seed baseline).

Language: TypeScript or Python — decided in the Nov 21 slot; the slate generator and keeper are TypeScript, so TS is the default unless the port of the Python forecasters argues otherwise.
