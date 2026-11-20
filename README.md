# FairOdds

*Polymarket starts every market at a guess. FairOdds starts every market at a forecast — seeded into Paradigm's pm-AMM at the model's fair price, crowd-funded by its own believers, and graded on-chain.*

Prediction markets whose opening price is set by a calibrated forecasting model, not a coin flip — seeded into the **pm-AMM** (PREDICT) at the model's fair probability, crowd-funded by **commitment vaults**, resolved by **Pyth**, with the model's track record (Brier score) committed on-chain *before* trading opens.

Built for the Solana "Perps & Prediction Markets" hackathon (submission-complete target: **Dec 5, 2026**). Full battle plan: `../PLAN.md`.

## Layout

| Dir | What |
|---|---|
| `programs/forecast-registry/` | Anchor program — commits prediction hashes on-chain before trading opens, posts resolution attestations |
| `engine/` | Off-chain forecast engine (kernel log-ratio forecaster + regression stack) — outputs fair probability + CI per market |
| `keeper/` | Keeper bot — daily market slate, prediction-hash posting, resolution triggers, traction dashboard |
| `app/` | Next.js frontend — market list, model-vs-market edge meter, vault commit flow, Brier leaderboard |
| `scripts/` | Devnet lifecycle scripts (create market → swap → claim) via `@pm-amm/sdk` |
| `tests/` | Rust unit tests + LiteSVM/Mollusk in-process tests (no local validator — sandbox blocks UDP) |
| `docs/` | `ARCHITECTURE.md`, `BUILD-LOG.md` |

## Key addresses

- pm-AMM program (devnet + mainnet, same ID): `GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y`
- ForecastRegistry program ID: TBD (devnet deploy, Nov 22 slot)

## Status

Scaffold only (Nov 19). See `docs/BUILD-LOG.md`.
