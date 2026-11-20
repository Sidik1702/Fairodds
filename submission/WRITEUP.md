# FairOdds — Submission Write-Up (ready to paste)

**Project name:** FairOdds
**Team:** Pasukan Satset (Gio — entrant; built with his AI-agent team)
**Event:** Solana "Perps & Prediction Markets" Hackathon (hackathons.solana.com)
**Tracks targeted:** Main track ($50k / $30k / $20k) + PREDICT "Best use of the pm-AMM" bounty ($1,000 investment + Spark support)
**Demo video:** `demo-video.mp4` (in this folder; upload per SUBMISSION-CHECKLIST.md)
**Repository:** https://github.com/Sidik1702/fairodds

---

## One-line pitch

**Polymarket starts every market at a guess. FairOdds starts every market at a forecast** — seeded into Paradigm's pm-AMM at a model's calibrated fair price, committed on-chain before trading opens, and graded on-chain when it resolves.

## The problem

Two things are broken in prediction markets today:

1. **Markets open mispriced.** A binary market seeded at a flat 50% is wrong by construction for almost every real question. While the price crawls toward fair value, liquidity providers are picked off by anyone who knows better — and on constant-product AMMs and LMSR, LP losses are price-dependent and approach total near expiry, so rational LPs stay away.
2. **Forecasters have no trustworthy track record.** Anyone can claim "we called it" after the fact. Predictions live in private databases and screenshots; the misses quietly disappear. There is no way for a market — or an investor — to verify that a forecaster is actually calibrated.

## The solution

FairOdds turns a forecasting model into a market maker with a public conscience:

- The **opening price of every market is the model's calibrated fair probability**, seeded into the pm-AMM via its custom-seed feature (any start price 1–99%) — not a coin flip.
- **Before the market exists**, the model's prediction (market, probability, strike, model version, and a hash of the payload) is written to Solana in our **ForecastRegistry** program. One record per market; it is structurally impossible to edit or re-commit.
- After resolution, the outcome is attested against the same record and **the program itself computes the Brier score**. Anyone can recompute the model's entire track record from chain data alone — no trust in FairOdds required.

The primitive, named plainly: **forecast-conditioned pm-AMM seeding with on-chain Brier accountability.**

## How it works

1. **Engine.** A kernel-weighted comparables forecaster (adapted from our proven make.fun forecasting stack — kernel log-ratio model, GTA CCU forecast LOO loss 0.186 vs 0.283 house baseline) estimates P(YES) for short-horizon price-threshold questions ("Will SOL close above $X in 24h?"). It works in log-ratio space over trailing-return and volatility features, weights historical comparables by a Gaussian kernel, and shrinks toward the base rate by the kernel's effective sample size.
2. **Commit.** The keeper converts the probability to basis points and calls ForecastRegistry `commit_prediction` — writing the market address, probability, strike, model version, prediction hash, and timestamp into a PDA (seeds `[b"prediction", market]`) **before the market is created**.
3. **Seed.** The keeper then creates the pm-AMM market with a caller-chosen market ID (so the commitment provably comes first), `initialPriceBps` = the model's probability, plus the initial LP deposit. The market opens where the model stands.
4. **Resolve.** At expiry the outcome is a mechanical function of the reference price vs the strike (YES iff price > strike). Resolution/settlement run through the pm-AMM's own instructions (1 winning token = 1 USDC; YES+NO pairs always redeemable 1:1).
5. **Attest.** The keeper calls `attest_resolution` with the outcome and the price evidence (account, observed price, slot). Guards are enforced in-program: unresolved-only, forecaster-only, strictly-after-commit-time. The program computes `brier_score_e8 = (prob_bps − outcome·10000)²` in exact integer math and stores it next to the original commitment.

## Why the pm-AMM (and not an order book, LMSR, CPMM, or parimutuel)

Outcome tokens grow more volatile near 50% and near expiry. On CPMM/LMSR designs, LP loss is a function of price and becomes near-total at expiry — which is exactly why seeding a market at a *fair* price is normally a good way to lose money: the better your seed, the more toxic the flow against it while it stays right. The pm-AMM's **uniform LVR** makes expected LP loss a *constant fraction of pool value regardless of the current price*, and the dynamic variant decays liquidity like √(T−t) toward expiry. That property is what makes model-fair seeding economically survivable for LPs. An order book would need professional market makers to quote a fair opening price; FairOdds gets it from a model + pm-AMM math. The pm-AMM is not a component of FairOdds — it **is** the market layer: seeding, liquidity, swaps, and settlement all run through its 34 instructions.

## What was built (all live on Solana devnet, all verifiable)

| Piece | Status | Evidence |
|---|---|---|
| **ForecastRegistry program** (Anchor, ours) | Deployed to devnet, executable; deployed bytecode sha256 byte-identical to the shipped source build | Program: [G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU](https://explorer.solana.com/address/G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU?cluster=devnet) · Deploy tx: [EysiVYth…](https://explorer.solana.com/tx/EysiVYthJRkLA6WvHEmSxqun6k7m1bF13BPY5pzcKPuGUc11uy2RxEgbSExQhdVTprsdvM8oGW4RYfmzW4Ex7vc?cluster=devnet) |
| **Forecast engine v1** (Python, pure stdlib) | Backtested walk-forward on 180 days of real SOL/BTC hourly data (Coinbase), 6,320 forecasts, no look-ahead | Results below; full report in `forecast/REPORT.md` |
| **Keeper** (TypeScript) | Full cycle run live on devnet: commit → create → resolve → attest | Transactions below |
| **Demo app** (Vite + React) | Reads every PredictionRecord + both pm-AMM markets live from devnet; renders the track record with zero backend trust | Static build in `app/dist/`; screenshot in `app/examples/` |
| **Tests** | ForecastRegistry: 14 Rust unit tests + 3 LiteSVM in-SVM lifecycle tests, all green (double-commit rejected, stranger attestation rejected with error 6003, double attestation rejected 6002, prob >100% rejected 6000). Keeper: 21/21 unit tests green | `cargo test`, `npm test` output in build log |

### The live end-to-end run (devnet, Nov 21, 2026)

Question: *"SOL above $68.50 in 6 min?"* — model probability **6200 bps (62%)**, LP deposit 10 mock-USDC.

| Step | Transaction (all finalized, err = null) |
|---|---|
| **Commit** `commit_prediction` — landed *before the market existed* | [4Aij4Cog…](https://explorer.solana.com/tx/4Aij4CogZRm86iZ5p6HYNH2bwKVEXGaQdVmNjvUvvj3TSXCpVL1WrRaT7P1i51dnQZGMZUkiFTTEhMj4UHEruMnu?cluster=devnet) |
| **Create** pm-AMM market, custom seed 62% | [4oPQGst7…](https://explorer.solana.com/tx/4oPQGst7kVKfjtVNKc9fdrBFbBwGXGsM75JweRdtkpNa15XhJgYd7qduiiS2T2hANYGWmoz6cRxfcsStfbFzvwBG?cluster=devnet) |
| **Resolve** (observed $68.58 > strike $68.50 → YES) | [3nnrriN6…](https://explorer.solana.com/tx/3nnrriN6LakGULYCAWruFuYzbKzJTY15MQyQakcxN38KCqbzSSvPXeRAtAccCZPSSrwMgKshfo6XsrvQq9TZQbZf?cluster=devnet) |
| **Attest** `attest_resolution` → Brier computed in-program | [bABje8Sj…](https://explorer.solana.com/tx/bABje8SjXwXV5jJumFDiqJaMuytEC5KC8wT6BBSUPCa8KVSTz3J58vPwQVv5fZV8JQWjYYy81VYWD3yNifTrsAi?cluster=devnet) |

- **PredictionRecord:** [AJdwPfYkg3577B46VjPhAfVV7r1dnXryQkN5uEVquALq](https://explorer.solana.com/address/AJdwPfYkg3577B46VjPhAfVV7r1dnXryQkN5uEVquALq?cluster=devnet) — prob 6200 bps, strike $68.50, observed $68.58, outcome YES, **Brier 0.1444** (vs 0.2500 for a flat-50% forecast — 42.2% better). Prediction hash recomputed from the stored fields: match.
- **Market (Step-3 run):** [3KhWpiKLmWt4DJn4EbBJfRFK5M68Dpz5yto8HKd7zvAu](https://explorer.solana.com/address/3KhWpiKLmWt4DJn4EbBJfRFK5M68Dpz5yto8HKd7zvAu?cluster=devnet) — resolved, YES won.
- **Market (Day-2 full lifecycle — create → swap → resolve → claim):** [9mxS9rrZekcwvFPVo1nVqqNxNiE9PExhuSvyqzh3Vxni](https://explorer.solana.com/address/9mxS9rrZekcwvFPVo1nVqqNxNiE9PExhuSvyqzh3Vxni?cluster=devnet) — a 5 mUSDC swap bought 7.677492 YES at the 62% seed; after YES resolution the claim redeemed exactly 7.677492 mUSDC, 1:1.
- **pm-AMM program (PREDICT):** [GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y](https://explorer.solana.com/address/GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y?cluster=devnet)

**One honest implementation note:** on devnet, the legacy Pyth SOL/USD feed is stale (last update ~200M slots old) and the Pyth pull-oracle endpoint is not reachable from our build sandbox, so the live run's expiry price was read from Coinbase Exchange — the forecast engine's own data source — and the record's `pyth_price_account` is attested as the none sentinel, with the substitution documented in the run evidence. The stale feed was never presented as a live read. Wiring a Pyth PriceUpdateV2 posting step is the first post-hackathon fix; the attestation format already carries the price-account field for it.

## Backtest results — stated honestly

Walk-forward, no look-ahead, 180 days of hourly Coinbase closes (4,320 per asset), 3-week burn-in, origins every 6h, strikes at spot × {0.95, 0.975, 1.00, 1.025, 1.05} → **6,320 forecasts**. Brier score, lower is better:

| Forecaster | Overall | SOL | BTC |
|---|---|---|---|
| **FairOdds kernel model** | **0.1073** | 0.1262 | 0.0884 |
| Naive momentum (Normal, trailing-24h drift) | 0.1464 | 0.1726 | 0.1201 |
| Unconditional base rate | 0.1057 | 0.1244 | 0.0870 |
| Coin flip (flat 50% — the default pm-AMM seed) | 0.2500 | 0.2500 | 0.2500 |

- **57% better than the coin-flip seed** a default binary opens at, and **27% better than naive momentum** — and better than momentum at *every* strike. Momentum is also badly calibrated (it says 2.6% and realizes 8.8%; says 97.5% and realizes 90.3%); the model's high-mass buckets are accurate to ~0.01.
- **The honest caveat: in this sample the model ties the unconditional base rate** (0.1073 vs 0.1057 — a 0.0016 gap, inside noise). The 180-day window is a single persistent downtrend for both assets (SOL −20%, BTC −22%), so unconditional frequencies were already extremely informative — and the model's shrinkage target *is* that base rate, by design. Demonstrating a conditioning edge needs a multi-regime sample.
- **v1's claim is therefore narrower, and defensible:** fair, *calibrated* seeds — far better than 50% or momentum, never worse than the base rate by more than noise — with every live forecast from now on pre-registered and graded on-chain, misses included. At-the-money 24h direction is near a random walk for everyone (0.253–0.260 for base rate and model; 0.348 for momentum), and our report says so instead of hiding it.
- **Roadmap:** extend history to 2+ years (multi-regime), per-regime and per-category Brier reporting, held-out-fold hyperparameter validation (bandwidth and shrinkage were set a priori, never tuned on the backtest), then the daily live slate so the on-chain record grows through judging.

## Fee economics — why the creator is aligned

The pm-AMM charges a **2% swap fee on the USDC leg, split 50% protocol / 50% market creator**. As the market creator, FairOdds therefore **earns 1% of swap volume on every market it seeds** — verified in our own Day-2 run, where swapping on our own market cost an effective 1% (the creator half of the fee stayed with us; only the protocol's 1% left the wallet). This makes the business model native to the pm-AMM: forecast well → seed fair markets → fair markets attract flow instead of arbitrage → flow pays the forecaster. No token, no subscription, no spread games. (The commitment-vault market type — the crowd co-funds a launch and committers become LPs — is the second pm-AMM feature in our design; the vault opening step is implemented in the keeper's plan layer and is next after the core cycle proven here.)

## Traction — the real numbers today

Stated plainly, because the bounty asks for numbers, not plans: FairOdds today is a **complete, verified devnet demonstration**, not a mainnet product with users.

- 2 pm-AMM markets created on devnet, both seeded at a model price (6200 bps), both resolved YES.
- 1 full forecast cycle graded on-chain (commit → create → resolve → attest, Brier 0.1444 stored by the program).
- 1 full trading lifecycle (create → swap → resolve → claim, exact 1:1 redemption).
- All activity is mock-USDC on devnet by a single operator wallet — **zero real users, zero real volume so far**, and we won't dress that up.
- What is proven is the part that has to exist before traction means anything: the seeding mechanic, the tamper-proof grading, and the fee alignment all work end-to-end on the real pm-AMM deployment. The traction plan is mechanical from here: a daily slate of 24h SOL/BTC threshold markets (the slate generator already emits 6 candidates/day with seeds), share links per market, and a public track-record page that makes the model's grade the marketing.

## Why FairOdds fits the PREDICT pm-AMM bounty specifically

1. **pm-AMM is the core, not a side feature.** Every market is a real pm-AMM market; seeding, liquidity, swaps, resolution, and settlement all flow through the pm-AMM program. FairOdds writes no AMM code of its own.
2. **It uses the pm-AMM's most distinctive feature as its central mechanic.** Custom seed prices exist so a market can open somewhere other than 50% — FairOdds is a product built entirely around *what that opening price should be and who stands behind it*. Most entrants will use plain 50% binaries; we use the seed as the product.
3. **The seeds come from a real, measured model** — not a placeholder. The forecaster has a walk-forward backtest (6,320 forecasts), a calibration table, and now an on-chain record that started with a verified 0.1444.
4. **Creator-fee alignment is the business model.** The 50% creator share of the pm-AMM's swap fee is exactly how a forecaster-market-maker gets paid; our submission quantifies it (1% of volume) from our own transactions.
5. **It contributes back to the pm-AMM's known gaps.** The plan's roadmap includes the multi-outcome probability-coherence keeper the pm-AMM docs themselves suggest, and the ForecastRegistry pattern (pre-registered predictions + in-program scoring) is reusable by any forecaster on the pm-AMM.
6. **Standalone potential.** FairOdds is a fundable product shape: a forecasting desk whose P&L is creator fees on markets it seeds fairly, with a public, unforgeable grade as its brand. The $1,000 investment + Spark/Backable support would fund the mainnet pilot and the multi-regime model upgrade.

## What's next (post-hackathon roadmap)

1. Pyth PriceUpdateV2 pull-oracle posting at resolution (replacing the documented Coinbase fallback).
2. Daily live slate on devnet → mainnet pilot decision with real traction logging (users / trades / volume / fees).
3. Commitment-vault launches wired into the keeper's create step.
4. Multi-regime (2+ year) backtest + per-category Brier leaderboard in the app.
5. Multi-outcome coherence keeper (contribution to the pm-AMM ecosystem).

---

*FairOdds — by Pasukan Satset. Devnet demonstration; mock USDC only; no real funds; not financial advice.*
