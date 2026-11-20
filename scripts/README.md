# scripts/ — devnet lifecycle scripts

First build slot (Nov 20): run the pm-AMM builder kit end-to-end on **devnet** via `@pm-amm/sdk` and capture explorer links for each step:

1. `create-market` — `PmAmmClient.createMarket({ name, durationSecs, initialPriceBps, depositUsdc })` (custom-seed binary; also the commitment-vault variant).
2. `swap` — a YES/NO swap against the created market.
3. `deposit-liquidity` — add LP after launch.
4. `claim` — `claimWinnings` after resolution.

Collateral on devnet is mock USDC from the pm-AMM faucet (predict-pm-amm.dev reference app). Every script simulates before sending and prints the tx signature + explorer link — those links become demo evidence in the README.

**Status (2026-11-20, updated night):** implemented as `pmamm-lifecycle/lifecycle.cjs` (`create` / `settle` phases, custom seed 6200 bps). **Lifecycle COMPLETE on devnet** — market created, swap, resolve and claim all finalized with explorer links (see `docs/BUILD-LOG.md`, "Day-2 completion" entry). Settle was finished via `settle2.cjs` (HTTP status polling instead of websocket confirmation, which the sandbox breaks).
