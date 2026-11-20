# FairOdds — Architecture

Derived from `../PLAN.md` (Concept A, the recommended build). Everything below traces to the plan; where the plan leaves a choice open, it is marked **open**.

## 1. Components

| Component | Where | Role |
|---|---|---|
| **pm-AMM program** (PREDICT, external, already deployed) | Solana devnet + mainnet, program `GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y` | The market engine. All seeding, liquidity, swaps and settlement run through its 34 instructions. FairOdds never reimplements an AMM. |
| **Forecast engine** | `engine/` (off-chain, TS/Python) | Produces calibrated fair probabilities for short-horizon crypto questions. Adapted from Gio's make.fun stack: kernel-weighted log-ratio forecaster + Huber IRLS regression / category-median multiples. |
| **ForecastRegistry program** | `programs/forecast-registry/` (Anchor, ours) | Small on-chain program: commits prediction hashes *before* trading opens and posts resolution attestations. The tamper-proof track record. Custodies no funds. |
| **Keeper bot** | `keeper/` (TypeScript) | Creates the daily market slate, posts prediction hashes, triggers resolution after expiry, publishes the traction dashboard. |
| **Frontend** | `app/` (Next.js) | Market list with model-vs-market edge meter, trading via `@pm-amm/sdk`, vault commit flow, forecaster leaderboard (Brier + calibration), traction dashboard. |
| **Pyth price feeds** | External oracle | Determine resolution of price-threshold markets at expiry. |
| **Devnet scripts** | `scripts/` | SDK lifecycle runs (create → swap → deposit → claim) that generate explorer-link evidence. |

**Why the pm-AMM (the plan's core argument):** outcome tokens grow more volatile near 50% and near expiry; constant-product AMMs and LMSR make LP losses price-dependent and near-total at expiry. The pm-AMM's uniform LVR makes expected LP loss a *constant fraction of pool value regardless of price*, and the dynamic variant decays liquidity like √(T−t) toward expiry. That property is what makes seeding a market at a model-fair price economically survivable for LPs — and it cannot be replicated on an order book without professional market makers. pm-AMM is therefore the product's core, not a side feature.

## 2. How the forecasting model seeds a market

1. The engine takes a short-horizon question from the slate templates — v1 scope is price thresholds only, e.g. "Will SOL close above $X in 24h?" (strikes set from spot ± bands by the slate generator).
2. It outputs a **calibrated fair probability** plus a confidence interval, per market category.
3. The keeper converts the probability to basis points and creates the market on the pm-AMM as a **binary with custom seed**: `createMarket({ name, durationSecs, initialPriceBps = model probability, depositUsdc })` via `@pm-amm/sdk`. The market therefore *opens at the model's fair price* instead of the default 50%.
4. Before trading opens, the keeper calls ForecastRegistry `commit_prediction` with a hash of (market, model probability, model version, timestamp) plus the payload — so the prediction is fixed on-chain before anyone can trade on it, and cannot be retro-edited once the outcome is known.
5. Traders then trade against the pm-AMM; the frontend shows the live market price next to the committed model price (the "edge meter").

## 3. Commitment-vault bootstrap flow

The pm-AMM's commitment-vault market type lets the crowd co-fund a market's launch:

1. Keeper creates the market with its commitment vault and a USDC target (seed = model probability, as above).
2. Users commit USDC into the vault through the frontend's commit flow.
3. When the target is met, the market launches with the pooled USDC as initial liquidity, seeded at the model's price.
4. **Committers become the market's LPs** — they hold the LP position pro-rata and earn the LP share of the pm-AMM's 2% swap fee (fee is on the USDC leg, split 50% protocol / 50% market creator per the pm-AMM design).
5. If the target is not met, the market does not launch (vault semantics per the pm-AMM program).

This is the second distinctive pm-AMM feature FairOdds uses as a core mechanic: believers in the model's price literally fund the market at that price.

## 4. Resolution via Pyth

1. Each market is a price-threshold question over a Pyth-tracked asset (SOL/BTC in v1), so the outcome is a mechanical function of the Pyth price at expiry: score = price − strike; YES wins iff score > 0 (the pm-AMM's Gaussian-score framing).
2. At expiry the keeper reads the Pyth price feed for the asset.
3. The keeper posts `attest_resolution` to ForecastRegistry recording the outcome, the Pyth price account used, the observed price and the slot — making the derivation auditable by anyone.
4. The keeper then drives the pm-AMM's own resolution/settlement path; winners redeem at 1 winning token = 1 USDC, and YES+NO pairs are always redeemable 1:1 for USDC (pm-AMM settlement rules).
5. **Known gap, per the plan:** the pm-AMM's resolution is currently centralized (a resolution authority; no oracle/dispute layer yet). FairOdds' mitigation for the hackathon build is the attestation trail above — every resolution carries its Pyth evidence on-chain. **Contingency (plan §1 risks):** if Pyth devnet feeds misbehave, resolve the demo slate manually-but-attested (same attestation record, keeper-observed price) and keep the market-type scope to price thresholds only.

## 5. Brier-score recording (the on-chain track record)

1. Every prediction is committed on-chain **before** trading opens (§2, step 4): market, model probability in bps, model version, hash.
2. Every resolution is attested against the same record (§4, step 3): outcome YES/NO with Pyth evidence.
3. The Brier score for a prediction is (model probability − outcome)², outcome ∈ {0, 1}. Because both inputs live on-chain in ForecastRegistry records, **anyone can recompute the model's Brier score — overall and per category — from chain data alone**, without trusting FairOdds' database.
4. The frontend leaderboard renders exactly that: per-category Brier scores, a calibration chart (predicted vs realized frequency), and a verification link from each score back to its commitment + attestation transactions.
5. The honest-baseline comparison is built into the story: a market seeded at a flat 50% has Brier 0.25 on every resolved market; FairOdds publishes whatever score it actually achieves against that baseline.

## 6. Environment constraints shaping the design

- **No local validator:** this VM's sandbox blocks UDP, so `solana-test-validator` cannot run. ForecastRegistry is tested with Rust unit tests + **LiteSVM/Mollusk in-process SVM tests**; pm-AMM interaction is tested against its real devnet deployment.
- **Devnet over HTTPS RPC** (OrbitFlare free Developer week first, public devnet fallback) — remote clusters are unaffected by the local UDP block.
- **Simulate-first:** every send in keeper/scripts/frontend paths runs `simulateTransaction` first; retries use fresh blockhashes.
- **Evidence:** every lifecycle step is logged with its tx signature → Solana explorer links embedded in the README and demo.

## 7. Open items (from PLAN.md §5 — verification list)

Exact deadline (page shows Dec 5 vs brief's Dec 6 — plan assumes Dec 5), submission-form fields, demo/video rules, number of selectable sponsor tracks, devnet-vs-mainnet judging expectations, pre-existing-code disclosure rules, OrbitFlare claim timing, judging timeline. These gate later build decisions (notably the Dec 1 mainnet go/no-go, which needs Gio's explicit approval — no real funds move without it).
