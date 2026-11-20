# FairOdds — Build Log

## Day 1 — Thu Nov 19, 2026 (scaffold; ahead of the plan's Nov 20 repo-scaffold slot)

### Scaffolded

Local-only skeleton at `~/workspace/hackathons/solana-perps/fairodds/`. No wallets created or funded, no transactions, no builds run, nothing submitted or deployed.

```
fairodds/
├── README.md                  — pitch, layout, key addresses, status
├── Anchor.toml                — devnet cluster; ForecastRegistry ID placeholder; pm-AMM noted as external
├── Cargo.toml                 — workspace (members = programs/*)
├── .gitignore                 — target/, node_modules/, keypairs, .env
├── programs/
│   └── forecast-registry/
│       ├── Cargo.toml         — anchor-lang 0.31.0
│       └── src/lib.rs         — instruction signatures only: commit_prediction,
│                                attest_resolution, PredictionRecord account,
│                                PredictionCommitted / ResolutionAttested events
├── app/                       — package.json (Next.js + @pm-amm/sdk manifest, NOT installed) + README (page plan)
├── engine/                    — README (forecaster adaptation plan, v1 scope: 24h SOL/BTC thresholds)
├── keeper/                    — package.json (@pm-amm/sdk manifest, NOT installed) + README (slate/resolution/traction duties)
├── scripts/                   — README (Nov 20 devnet lifecycle script plan)
├── tests/                     — README (Rust unit + LiteSVM/Mollusk strategy; no local validator)
└── docs/
    ├── ARCHITECTURE.md        — components, seeding flow, vault bootstrap, Pyth resolution, Brier recording
    └── BUILD-LOG.md           — this file
```

### Toolchain present in the VM (checked Nov 19, read-only)

| Tool | Version | Location |
|---|---|---|
| Anchor CLI | 0.31.0 | `~/.local/bin/anchor` |
| Cargo | 1.100.0 (3acc79c0c 2026-11-05) | `~/.cargo/bin/cargo` |
| Rustc | 1.100.0 (0ef1bc386 2026-11-09) | `~/.cargo/bin/rustc` |
| Solana CLI | 2.1.21 (Agave) | `~/.local/share/solana/install/active_release/bin/solana` |
| Node | v24.22.1 | `/usr/bin/node` |
| pnpm | 10.4.1 | `~/.local/bin/pnpm` |

Notes:
- Fresh shells do **not** have cargo/solana/anchor on PATH — prefix commands with `export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.local/bin:$PATH"`.
- `cargo-build-sbf` / `cargo-test-sbf` are present in the Solana bin dir (needed for program builds in later slots).
- LiteSVM/Mollusk are library crates, not binaries — they get added as dev-dependencies in the Nov 22 slot.
- Nothing was installed today, per instructions.

### Open questions

1. **Deadline Dec 5 vs Dec 6** (PLAN.md §5 #1) — plan is built to be submission-complete by Dec 5; confirm exact date/time/timezone from the hackathon page.
2. Rest of the §5 verification list: submission-form fields, demo/video rules, sponsor-track selection count, devnet-vs-mainnet judging expectations, pre-existing-code disclosure (the forecast engine adapts prior make.fun work), OrbitFlare claim timing, judging timeline.
3. **Engine language** — TypeScript (matches keeper/slate) vs Python (where the original forecasters live). Decide in the Nov 21 slot.
4. **ForecastRegistry program ID** — placeholder `1111…` everywhere until the Nov 22 devnet deploy.
5. **Keeper/devnet wallet** — Gio's Nov 22 weekend slot (faucet SOL + mock USDC). No wallet exists yet, by design.

### Next steps (in plan order)

1. **Nov 20** — Run the pm-AMM builder kit end-to-end on devnet via `@pm-amm/sdk` (create market → swap → claim; capture explorer links); set up the LiteSVM/Mollusk harness; claim OrbitFlare free RPC once the hackathon start allows. Gio (evening): confirm concept + name "FairOdds".
2. **Nov 21** — Forecast engine v1: adapt the kernel log-ratio forecaster to 24h SOL/BTC threshold questions; backtest + calibration report (Brier vs 50% baseline); market-slate generator. Gio (evening): pick launch slate categories (recommendation: SOL/BTC price thresholds only).
3. **Nov 22** — Implement ForecastRegistry instruction bodies; Rust unit + LiteSVM tests green; keeper skeleton (create-market flow with custom seed = model bps). Gio (weekend): devnet wallet setup + first hands-on SDK demo click-through.


## Day 2 — Fri Nov 20, 2026 (pm-AMM devnet lifecycle attempt — BLOCKED on devnet SOL faucet)

### Set up today
- Throwaway devnet tester keypair created: `6c1eJRKMymbts1wPK5yxDPBg9ZXcdXRVVRmFGVhNTHFH`, stored at `fairodds/devnet-tester.keypair.json` (gitignored via `*.keypair.json`). Devnet only; no real funds involved anywhere.
- Scratch workspace `scripts/pmamm-lifecycle/` (own package.json); installed `@pm-amm/sdk@0.2.0`, `@solana/web3.js`, `@anchor-lang/core`, `@solana/spl-token` (81 packages). SDK API verified against the shipped `dist/index.d.ts` before writing code: `send.createMarket` → `{marketId, marketPda, signature}`, `send.swap(market, direction, amountInMicro, minOutputMicro)`, `send.resolveMarket(market, "yes"|"no")`, `send.claimWinnings(market)`; `MarketAccount` fields (`endTs`, `resolved`, `winningSide`) confirmed.
- Lifecycle script `scripts/pmamm-lifecycle/lifecycle.cjs` (CommonJS, per the kit's Node/ESM gotcha with `@anchor-lang/core`):
  - `create` phase: preflight on-chain balance check → `send.createMarket` with **custom seed 6200 bps** (a model-style 62% FairOdds seed, not the 50/50 default), 300 s duration (on-chain minimum), 50 mUSDC bundled LP deposit → `send.swap` 5 mUSDC → YES → post-step state verification via `fetchMarket` + token balances.
  - `settle` phase: poll until `endTs` → `send.resolveMarket(market, "yes")` (creator is resolution authority) → `send.claimWinnings` → mUSDC balance-delta verification. Phase state persisted to `lifecycle-state.json`.
  - Note on simulate-first: `send.*` (the kit's canonical quickstart path) does not expose the built transaction for a separate `simulateTransaction`; the script instead gates every send on verified on-chain preconditions and verifies resulting state after each step. The `ix.*` builder route would allow raw simulation but requires manual ATA plumbing the kit itself warns about (`AccountNotInitialized 3012`) — deferred.

### What actually landed on devnet
- **mUSDC faucet claims — SUCCESS:** `POST https://pm-amm-devnet.vercel.app/api/faucet` → 1,000 mUSDC to the tester wallet, tx `5YTzMzeuc4sYQS7WowYib7RrS5ZfEbzNyJUUgRm2D43LH8o2YQv5JaLbxXXhUqc988cA5zVC7Qg3fbH6uMbPCdMR` — https://explorer.solana.com/tx/5YTzMzeuc4sYQS7WowYib7RrS5ZfEbzNyJUUgRm2D43LH8o2YQv5JaLbxXXhUqc988cA5zVC7Qg3fbH6uMbPCdMR?cluster=devnet
- A second 1,000 mUSDC claim went to a one-off auxiliary wallet while testing whether the faucet's SOL drip would fire (tx `4w19baxyoUy8CiJveodX8sERYkRGHjBJCSTFR9JXzaif9LEssE27o8mnpEAXeTxpHqNUvZsuKcH95XqnuPaueUAA`); that keypair file was deleted afterwards.
- **Script dry-run verified against live devnet:** `node lifecycle.cjs create` loads the wallet, constructs the `PmAmmClient`, reads balances over HTTPS RPC — `0 SOL, 1000 mUSDC`, exactly matching the faucet claim — and stops cleanly at the preflight SOL check. Everything except the SOL-funded sends is proven working.

### The blocker — devnet SOL (exactly one missing input)
- `solana airdrop` against `https://api.devnet.solana.com` attempted 7+ times over ~1 hour (15:22–16:18 UTC): responses alternated between "airdrop request failed … rate limit is reached", RPC timeouts, and one JSON-RPC error 410 "The RPC faucet is closed on this cluster. Request test SOL at https://faucet.solana.com". The public RPC is a load-balanced pool and this VM's shared egress IP sits inside the faucet's per-IP rate limit.
- Alternate public devnet RPC ingresses tried for `requestAirdrop`: Blast (empty reply), Omnia (HTTP 521), extrnode (empty), meowrpc (empty), PublicNode (empty), OnFinality (empty), Ankr (demands an API key — creating accounts/keys is out of scope).
- pm-AMM faucet SOL drip: skipped on both claims — `"sol":0, "solSkipped":"reserve"` (the faucet's own SOL reserve is dry right now).
- `faucet.solana.com` is web-only (captcha / GitHub login) — not usable headless, and Gio's accounts are never operated by agents.
- A final background retry cycle's approval card timed out unanswered, so its faucet re-claim step was not performed; per the runtime's instruction it was not retried. **That retry still needs Gio's approval if he wants it run again.**

### Unblock (any one, ~1 minute of human time)
1. From any normal network (Gio's PC/phone): send ≥ 0.5 devnet SOL to `6c1eJRKMymbts1wPK5yxDPBg9ZXcdXRVVRmFGVhNTHFH` via faucet.solana.com or a wallet's devnet faucet. Then `cd scripts/pmamm-lifecycle && node lifecycle.cjs create && node lifecycle.cjs settle` — the full create → swap → resolve → claim cycle takes ≈ 6 minutes (300 s market) and prints Solana Explorer (devnet) links for every step.
2. Or re-run `solana airdrop 1 6c1eJRKMymbts1wPK5yxDPBg9ZXcdXRVVRmFGVhNTHFH --url https://api.devnet.solana.com` from this VM later, once the shared-IP rate-limit window clears.

### Not done (gated, per plan)
- LiteSVM/Mollusk harness for ForecastRegistry — was conditional on the lifecycle completing; remains part of the Nov 22 slot regardless.
- OrbitFlare free-RPC claim — still needs Gio's own signup (unchanged).

## Panel consultation — 2026-11-19 night (DeepSeek via Coarena, full text in ~/workspace/panel-consult-2026-11-19-round2.md)

Three judging risks + mitigations to design around from day 1:
1. **Live-demo fragility** — the ML→Solana→AMM→resolution chain has too many failure points for a raw live demo. Mitigation: deterministic demo path (local validator + pre-seeded market + scripted trade → resolve → Brier update), forecasts precomputed and stored as signed forecasts in a PDA, live ML calls optional, plus a recorded backup run.
2. **Novelty must be visible in 30 seconds** — name the primitive explicitly: "forecast-conditioned pm-AMM seeding with on-chain Brier accountability". Demo side-by-side ML-seeded vs flat-seeded on the same market history (slippage, LP P&L, calibration); model hash + forecast timestamp committed in the PDA before the market opens.
3. **Brier track record must be anti-cherry-pick** — all forecasts pre-registered on-chain before resolution, Brier computed in-program, show rolling out-of-sample Brier + sample size + 0.25/climatology baseline + calibration plot, and include losing forecasts (judges trust a record with visible misses).

## Day-2 completion — 2026-11-20 night: pm-AMM devnet lifecycle COMPLETE ✅

The blocker from the Day-2 entry above is resolved and the full lifecycle ran end-to-end on devnet. Gio sent 0.5 devnet SOL from his own network to the tester wallet `6c1eJRKMymbts1wPK5yxDPBg9ZXcdXRVVRmFGVhNTHFH` (balance verified on-chain: 500,000,000 lamports), which unblocked the sends.

### The run (all signatures finalized on-chain, verified via HTTPS `getSignatureStatuses`)
- **Market:** `9mxS9rrZekcwvFPVo1nVqqNxNiE9PExhuSvyqzh3Vxni` — https://explorer.solana.com/address/9mxS9rrZekcwvFPVo1nVqqNxNiE9PExhuSvyqzh3Vxni?cluster=devnet
- **Market parameters:** custom seed **6200 bps** (62% model-style FairOdds seed), duration **360 s**, 50 mUSDC bundled LP deposit, endTs 1795193491.
- **Create:** https://explorer.solana.com/tx/4eH5HU77ZF5nZ7QpUs3bqBe1EtQfS9jZ2h3Q4cWRD8iwRur99JofBUxRMR7hhjSKBDvF3j8VpxJxydkYtAbyXd4L?cluster=devnet
- **Swap (5 mUSDC → YES):** https://explorer.solana.com/tx/5zchVyvXpA3FSaPbvWoXMtoz4pRcWhxU9kjgcVgLP2rmnbirPkNqRQmbvFrHHH3yCttocvvtsAQGJfQobNMEb4HT?cluster=devnet — YES balance after swap: **7.677492 YES**
- **Resolve (YES):** https://explorer.solana.com/tx/2vXJVDqmyFbBbvj2JnxHbSsAjPgNsLLkQ94uT7rm9V1yBpTF3dtcDD6KYiRSQ3HLj4SNffWDRyYsRBssPpP4BL5t?cluster=devnet
- **Claim winnings:** https://explorer.solana.com/tx/5u2MoBAwDWzefudwZ64zt5KHaDA4tA9nhfopcjEYCKNoxP7Rc12183r94AW6hWZoGHtEbXU1cLEFmjauso5qeYgC?cluster=devnet — **claimed 7.677492 mUSDC** (YES redeemed 1:1, exactly the YES balance).
- **Funding reference (mUSDC faucet, 1,000 mUSDC):** https://explorer.solana.com/tx/5YTzMzeuc4sYQS7WowYib7RrS5ZfEbzNyJUUgRm2D43LH8o2YQv5JaLbxXXhUqc988cA5zVC7Qg3fbH6uMbPCdMR?cluster=devnet
- Final state recorded in `scripts/pmamm-lifecycle/lifecycle-state.json`.

### Operational lessons (hard-won, keep for every future devnet run)
1. **Market duration must be strictly above the 300 s on-chain minimum.** Exactly 300 s failed with `InvalidDuration` (Anchor error 6012, initialize_market.rs) — the effective duration lands a hair under the minimum by the time the transaction executes. **360 s works.** (The IDL states the rule as "5 min ≤ d ≤ 30 days", but 300 s exactly is not enough in practice.)
2. **The sandbox breaks websocket confirmations.** Both the create and the swap reported "Transaction was not confirmed in 30.00 seconds" — yet BOTH finalized on-chain. The market had to be recovered from the create transaction's account list after the first timeout. **Rule: NEVER retry a send on a confirmation timeout; ALWAYS verify via `getSignatureStatuses` over HTTPS first.** The fix pattern is `scripts/pmamm-lifecycle/settle2.cjs`: catch the timeout error, extract the signature from it, and poll its status over HTTPS until finalized — that pattern carried the resolve and claim steps cleanly.
3. **Devnet SOL faucets are rate-limited on this VM's shared egress IP.** The public RPC faucet, alternate RPC ingresses, and the pm-AMM faucet's SOL drip all failed over ~1 hour; a human send from a normal network (Gio, faucet.solana.com) unblocked the run in about a minute. For future runs, pre-fund the tester wallet from a human network instead of burning time on faucets from the VM.

### Status after Day 2
- pm-AMM lifecycle: **complete** (create → swap → resolve → claim, all with explorer evidence).
- Next per plan: forecast engine v1 (Nov 21) and ForecastRegistry instruction bodies + LiteSVM/Mollusk harness (Nov 22 slot).

## Step 1 — 2026-11-20 night: ForecastRegistry program implemented + verified ✅

Gio's standing order: execute the FairOdds build steps one by one to submission (target Dec 3), each verified to the pm-AMM-lifecycle standard. Step 1 = the ForecastRegistry instruction bodies with tests. Nothing deployed, nothing spent — local verification only.

### Implemented (`programs/forecast-registry/src/lib.rs`)
- **Program ID (generated locally, NOT deployed):** `G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU` — keypair at `target/deploy/forecast_registry-keypair.json` (gitignored); `declare_id!` + Anchor.toml updated.
- **`commit_prediction(market, prediction_hash, model_prob_bps, model_version, strike)`** — initializes the `PredictionRecord` PDA (seeds `[b"prediction", market]`, payer = keeper) storing market, forecaster authority, prediction hash, probability in bps, model version (≤ 32 chars), strike (raw Pyth-style units; YES wins iff observed price > strike), and the commit timestamp from the Clock sysvar. PDA `init` makes a second commit for the same market fail at the runtime level — re-commits are structurally impossible. Validation: prob must be ≤ 10,000 bps (`InvalidProbability` 6000), version length capped (`ModelVersionTooLong` 6001).
- **`attest_resolution(outcome_yes, pyth_price_account, observed_price, observed_slot)`** — guards enforced by a pure, unit-tested state machine (`ensure_attestable`): record must be unresolved (`AlreadyResolved` 6002), signer must be the committing forecaster (`UnauthorizedAttester` 6003), and attestation time must be strictly after the commit timestamp (`AttestationTooEarly` 6004) — a forecast can only be scored once its resolution is knowable and the commit provably predates it. Stores outcome + Pyth evidence (price account, observed price, observed slot, attested_at) and computes the **Brier score in-program**: `brier_score_e8 = (prob_bps − outcome·10000)²`, i.e. Brier × 1e8 in exact integer math (62% → YES = 14,440,000; flat-50 baseline = 25,000,000). Per ARCHITECTURE.md §4 the registry does not parse the pm-AMM market account; the authority + once-only + strictly-after-commit guards plus the on-chain Pyth evidence trail are the anti-retro-commit mechanism.
- Events extended with the new fields (`PredictionCommitted` carries strike; `ResolutionAttested` carries observed price/slot + Brier). Record space: 225 bytes total (INIT_SPACE 217 + discriminator).

### Verification (all commands run 2026-11-20 night, this VM)
- **Unit tests — `cargo test -p forecast-registry --lib`: 14 passed, 0 failed.** Brier math (6200/YES = 14,440,000; 6200/NO = 38,440,000; 50% baseline 25,000,000 both outcomes; extremes 0 and 100,000,000; symmetry/monotonicity sweep), bps bounds (10,000 ok / 10,001 rejected), attestation state transitions (happy path, already-resolved, wrong authority, at/before commit time, check ordering).
- **LiteSVM integration — `cargo test -p forecast-registry --test litesvm_lifecycle`: 3 passed, 0 failed.** Loads the real compiled `.so` in-process (the sandbox blocks UDP, so no local validator): commit → stored record asserted field-by-field → second commit rejected, record untouched → stranger attestation rejected with error 6003 → clock advanced → forecaster attestation succeeds, stored record shows `brier_score_e8 = 14,440,000` → second attestation rejected with error 6002. Plus: prob 10,001 rejected on-chain with error 6000 and no record persisted; attestation before any commit fails.
- **Build — `cargo build-sbf`:** `target/deploy/forecast_registry.so`, 214,368 bytes, ELF 64-bit eBPF, stripped. Re-verified after the dev-dependencies landed (see pin note below).
- **IDL — `target/idl/forecast_registry.json`:** complete — both instructions, PDA seeds resolved (`prediction` = const `"prediction"` + arg `market`), errors 6000–6004, both events, all types. Generated with anchor's own print test (workaround below).

### Toolchain lessons (cost real time; keep for every future build)
1. **The Solana platform-tools cargo (1.79) cannot parse edition-2024 manifests**, and the Nov-2026 registry snapshot resolves several transitive crates to edition-2024 / newer-MSRV versions. Pins now in `Cargo.lock` (via `cargo update --precise`; `anchor-lang = "=0.31.1"` is also pinned in the program manifest): anchor-lang 0.31.1, blake3 1.7.0, borsh 1.5.7, proc-macro-crate 3.3.0, zeroize 1.8.1, zeroize_derive 1.4.3, indexmap 2.9.0 (hashbrown follows at 0.15.5), unicode-segmentation 1.12.0. Adding the LiteSVM dev-deps bumped `zeroize_derive` to 1.5.0 and broke build-sbf again — re-pinned to 1.4.3; **after any dependency change, re-run `cargo build-sbf` before trusting the tree.**
2. **`anchor idl build` fails on the default (2026) nightly**: E0425 "cannot find value `market`" inside anchor's generated IDL test. Root cause proven with a minimal proc-macro experiment: newer rustc's `TokenStream` Display inserts spaces (`market . as_ref ()`), and anchor-syn 0.31.1 extracts PDA seed names from that string, so method-call seeds (`market.as_ref()`) miss their lookups and fall into a broken fallback. Nightly 2025-06-01 and 2025-11-15 still print the compact form (`market.as_ref()`). Workaround used: run anchor's print test under `nightly-2025-11-15` with `RUSTFLAGS="--cfg procmacro2_semver_exempt -A warnings"` and `ANCHOR_IDL_BUILD_RESOLUTION=TRUE`, then assemble the sections (the plain `anchor build` IDL phase stays broken until anchor/rustc converge; the `.so` phase is unaffected). June-2025 nightly is NOT usable for the full tree (locked `zerocopy` needs newer nightly features, E0658) — 2025-11-15 is the sweet spot.
3. **LiteSVM's default Clock has `unix_timestamp = 0`** — the harness seeds it (1,700,000,000) before committing; on a real cluster this is a non-issue.

### Status after Step 1
- ForecastRegistry: **implemented and verified locally** (unit + in-SVM lifecycle, Brier proven on the stored record). Devnet deployment is a later step and needs no funds beyond the already-funded tester wallet's devnet SOL.
- Next per plan: keeper skeleton (commit → seed market → attest wiring against the forecast engine), then frontend v1.

## Step 2 — 2026-11-20 night: keeper skeleton wiring ✅

Keeper skeleton built in `keeper/` (TypeScript/Node; deps installed: `@pm-amm/sdk@0.2.0`, `@anchor-lang/core@1.2.2`, `@solana/web3.js@^1.95.0` — the exact versions the Day-2 lifecycle proved). Default mode is **dry-run: it prints the plan and sends nothing.** Nothing was deployed, no transactions were sent, no funds moved.

### What was built
- **Forecast adapter (`src/slateSource.ts` + `src/jobs.ts`):** runs `forecast/slate.py` fresh (temp output file; falls back to the existing `forecast/slate.json` and says so in the plan header if Python cannot execute). Each slate entry becomes a validated `KeeperJob` `{marketQuestion, strike, probBps, initialPriceBps, endTs, …}` — validation mirrors the on-chain constraints: registry prob ≤ 10,000 bps and model_version ≤ 32 bytes, pm-AMM custom-seed band 100–9,900 bps (1–99%), duration 360 s–30 days (360 floor encodes the Day-2 lesson: exactly 300 s fails on-chain), plus slate self-consistency checks (`initial_price_bps == round(model_probability·10⁴)`, `expires_at == opens_at + duration_secs`). Strike is also carried in Pyth raw units (×1e8, exponent −8) for the registry.
- **Commit step (`src/registry.ts`) — PENDING-DEPLOY:** `ForecastRegistryClient` behind a `RegistryClient` interface builds the exact `commit_prediction` / `attest_resolution` instructions with anchor's `BorshInstructionCoder` driven by the Step-1 IDL (`target/idl/forecast_registry.json`), account metas taken from the IDL flags, PredictionRecord PDA derived from the program seeds `[b"prediction", market]`. The prediction hash follows the program's documented formula `sha256(market ‖ prob_bps u16LE ‖ model_version ‖ issued_at i64LE)`. Send methods throw `PendingDeployError` — the program (`G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU`) is verified locally but **not deployed**, so there is nothing to send to yet.
- **Seed step (`src/pmamm.ts`):** `planCreateMarket(job, depositUsdc)` (pure) produces the exact `createMarket({ name, durationSecs, initialPriceBps = probBps, depositUsdc })` parameters from lifecycle.cjs. Live `createSeededMarket` / `resolveMarket` / `claimWinnings` are implemented on the same SDK patterns, gated on `{ live: true }` (otherwise `DryRunOnlyError`), with every send wrapped in `sendAndConfirmHttp` — the settle2.cjs pattern (extract the signature from the ws-timeout error, poll `getSignatureStatuses` over HTTPS, never blind-retry) — and a market-PDA recovery path from the landed create transaction, as in the Day-2 run.
- **Attest step:** after `endTs`, the outcome is derived as YES iff observed raw price > strike raw (ARCHITECTURE.md §4) and the `attest_resolution` instruction is constructed through the same PENDING-DEPLOY client; the keeper also mirrors the program's Brier math (`expectedBrierE8`) so the expected score is visible before attesting.
- **CLI (`src/cli.ts`):** `npm run plan` = dry-run. `--live` is **refused by design** until the registry deploy lands: live execution must commit before it creates (ARCHITECTURE.md §2), and with the registry undeployed a live run would create un-committed markets — the one ordering the track-record design forbids.

### Verification (all run 2026-11-20 night, this VM)
- **Unit tests — `npm test` (node:test via tsx): 21 passed, 0 failed.** Jobs (9): field conversion, raw-strike conversion (SOL $67 → 6,700,000,000; BTC $58,050 → 5,805,000,000,000), seed-band/duration/version/slate-consistency rejections, hash determinism + input sensitivity, outcome derivation (at-strike = NO), Brier mirror matching Step 1's on-chain values (6200/YES = 14,440,000). Registry (5): PDA derivation, commit + attest instruction program/discriminator/account-flag exactness against the IDL, coder round-trips of both instructions' args, PENDING-DEPLOY gate on both sends. Plan/pm-AMM (7): five-phase ordering, commit-step hash/PDA/params, create-step seed params, illustrative-outcome + expected-Brier values, simulated-key determinism, deposit validation, live-gate refusals.
- **Typecheck — `npx tsc --noEmit`: clean.** (This caught one real SDK fact: `send.createMarket` returns `marketPda` as a base58 **string**, now handled explicitly.)
- **End-to-end dry-run — `npm run plan`: the Python engine executed fresh** (live Coinbase fetch; slate generated 2026-11-20T17:48:05Z) and the keeper printed the full ordered plan for **6 real market candidates** (SOL strikes $67.50/$69.00/$69.50 at 7195/4635/2849 bps; BTC strikes $57,750/$58,350/$58,950 at 8074/6791/3820 bps; all 24 h, endTs 2026-11-21T17:48Z), 5 steps each with all parameters — including the real 98-byte encoded `commit_prediction` and 57-byte encoded `attest_resolution` instructions, prediction hashes, and PDAs. Saved verbatim to `keeper/examples/dry-run-output.txt` (371 lines). Dry-run labeling is explicit in the output: market/keeper/Pyth keys are deterministic SIMULATED stand-ins, and the resolve/attest outcome is ILLUSTRATIVE (slate spot stands in for the expiry Pyth read; the real read happens at live resolution).

### What remains PENDING-DEPLOY / open after Step 2
- **ForecastRegistry devnet deploy** — the single blocker for registry sends and for unlocking the keeper's `--live` (commit-first ordering). Needs only the tester wallet's existing devnet SOL.
- Commitment-vault opening in the create step (second pm-AMM feature; the skeleton seeds via the bundled LP deposit, as the lifecycle did).
- Real Pyth price read at resolution time (today: labeled stand-in in dry-run; no Pyth account addresses are hardcoded anywhere).
- Traction dashboard (keeper duty #3) — not part of this step.
- Next per plan: frontend v1 (Nov 23 slot) or the registry deploy step, whichever Gio sequences first.

## Step 3 — 2026-11-21: registry deploy + live keeper run — BLOCKED at funding (nothing sent)

Gio's standing order: execute the steps one by one to submission (target Dec 3), each verified with on-chain evidence. Step 3 = deploy ForecastRegistry to devnet + flip the keeper registry client live + one full live end-to-end run. **The step stopped at its funding gate: the tester wallet is short of deploy rent, and no faucet route from this VM delivered.** Nothing was deployed, no transaction was sent, no funds moved.

### Verified starting state (HTTPS RPC, 2026-11-21)
- Tester `6c1eJRKMymbts1wPK5yxDPBg9ZXcdXRVVRmFGVhNTHFH`: **0.46460284 SOL** (464,602,840 lamports), **952.727492 mUSDC** — exactly the Day-2-verified balances.
- Deploy need: the 214,368-byte `forecast_registry.so` costs ≈ **1.493 SOL** programdata rent-exempt, plus PredictionRecord rent (≈0.0025 SOL) and send fees → task floor **≥1.6 SOL**, comfortable target **≥2.0 SOL**. Shortfall: **+1.1354 SOL** to the floor, **+1.5354 SOL** to target.

### Funding attempts (a few honest attempts, no retry loops — the Day-2 lesson)
1. `solana airdrop 2` via `https://api.devnet.solana.com` → **rate limit** (the VM's shared egress IP, same as Day 2).
2. Airdrop via PublicNode devnet → HTTP 404 (no faucet on that ingress).
3. Airdrop via Omnia devnet → request timeout.
4. pm-AMM faucet POST (its SOL drip refilled the wallet on no prior occasion — reserve was dry on Day 2 — but it was the remaining untried route) → **not performed: the runtime approval for that command timed out unanswered.** Per the runtime's instruction it was NOT retried. **This attempt still needs Gio's approval if he wants it run.**

### Unblock (any one)
- **Preferred (the Day-2 route that worked):** Gio sends **≥1.6 devnet SOL (ideally 2.0)** from his own network (faucet.solana.com or a wallet) to `6c1eJRKMymbts1wPK5yxDPBg9ZXcdXRVVRmFGVhNTHFH`. Then Step 3 resumes at the deploy.
- Or Gio approves the pm-AMM faucet POST retry (its mUSDC is not needed; only its SOL drip would help, and it was dry on Day 2).

### Prep findings banked for the resume (verified today, no chain writes)
- **Commit-before-create is implementable with a self-chosen market id:** the SDK's `send.createMarket` picks `marketId = randomU48()` internally (market PDA unpredictable pre-create), but the bound builders `client.ix.initializeMarket({authority, marketId, endTs, name, initialPriceBps, collateralMint})` + `client.ix.depositLiquidity(...)` + `client.sendIxs(...)` are exposed, and `client.marketPda(marketId)` derives the PDA from a caller-chosen id. The live keeper will: choose marketId → derive market PDA → `commit_prediction` against it → create with that exact id (same instruction bundle `send.createMarket` builds, incl. the 1,400,000-CU compute-budget ix) — ARCHITECTURE.md §2 ordering preserved exactly.
- **The legacy Pyth devnet SOL/USD feed is STALE — do not resolve from it.** Account `J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix` (owner = Pyth oracle program, expo −8) shows price $139.82 with `last_slot` 322,338,250 vs current slot 524,433,155, while Coinbase spot is **$68.76**. Hermes (`hermes.pyth.network`, both v2 and legacy endpoints) answers "unauthorized" from this sandbox. The live run's observed price therefore needs the documented fallback — a Coinbase Exchange read at expiry (the forecast engine's own data source), with the record's `pyth_price_account` left at the default (none) sentinel and the substitution stated plainly in the run evidence — or a dedicated Pyth pull-oracle (PriceUpdateV2) posting step later. Decision lands with the resume; the stale feed must never be presented as a live read.

## Step 3 completion — 2026-11-21: ForecastRegistry DEPLOYED + live keeper end-to-end run ✅

The funding gate from the entry above is resolved and Step 3 is complete: the program is deployed to devnet, the keeper's registry client is live, and one full commit → create → resolve → attest cycle ran on-chain and was verified independently over HTTPS RPC (a separate read-only pass: `getSignatureStatuses`, `getTransaction` balance deltas, and a manual Borsh decode of the record against the Rust struct layout — none of the keeper's own code paths).

### Funding
- Gio sent **5.0 devnet SOL** from his own network: tx `HfTDpvx7u48QmZPLtnVuDeKMS1HHjLZkTGaDktaHMTUpHD4kQDFp4d4b6CLrzL7qf6dkAXtAa1zGPNJHQR9yp2q` — tester balance verified **5,464,602,840 lamports** (464,602,840 + 5,000,000,000), mUSDC unchanged at 952.727492.

### Deploy (custom HTTPS deploy — the Agave CLI panicked on its websocket TPU client in this sandbox)
- `solana program deploy` died mid-flight on the sandbox's broken wss, but its create-buffer transaction had already landed: buffer `BhscEt6Ry5XdRWsbXhEP4PNCDG9mvnjR3o3x3wTuL8Kc`, tx https://explorer.solana.com/tx/3w1grShrHnB6sdnDDTuF8Mh8sijmzQoJPcTvKTP1bSSVkJEwSHKN3xUDfLfUeW5FJoUC7r8L2eUtrTzCqEVRivDv?cluster=devnet (funded 1,089,868,280 lamports, body all-zero at adoption).
- `scripts/pmamm-lifecycle/deploy-registry.cjs` adopted that buffer: **215 Write instructions** of 1,000 bytes each over raw HTTPS (`sendRawTransaction` + `getSignatureStatuses` polling; a chunk was re-sent only on provable blockhash-expiry with null status — instruction formats taken from the canonical `solana-loader-v3-interface` 5.0.0 source), verified the buffer body sha256 equals the `.so` sha256, then sent createAccount + DeployWithMaxDataLen.
- **Deploy signature:** https://explorer.solana.com/tx/EysiVYthJRkLA6WvHEmSxqun6k7m1bF13BPY5pzcKPuGUc11uy2RxEgbSExQhdVTprsdvM8oGW4RYfmzW4Ex7vc?cluster=devnet (finalized, err=null, slot 524,449,274).
- **Program:** `G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU` — account executable=true, owner = BPF Loader Upgradeable. **Programdata:** `5fVNkbe3qtBkBBkRgqtufqUxC7rmDpgHsgdWhKRVyM2w` — body sha256 `75fae4703f36a06d5549cd7dfd3bf33ae70a823e09dbb95bdbc876e070068c35`, byte-identical to the Step-1-verified `forecast_registry.so` (214,368 B). Full evidence incl. all 215 write signatures: `scripts/pmamm-lifecycle/step3-deploy-state.json`.

### Keeper flipped live
- `keeper/src/registry.ts`: the registry client now accepts an optional `{ live: { connection, signer } }` transport — with it, sends build → sign → `sendRawTransaction` (HTTPS) → `sendAndConfirmHttp` polling; without it, sends still throw `PendingDeployError`, so the dry-run plan CLI and the unit tests remain send-free by construction. Dedicated live runner `keeper/src/liveRun.ts` (`npm run live`) checkpoints state to `keeper/examples/step3-live-state.json` after every step and refuses to start if that file already exists. `npx tsc --noEmit` clean; `npm test` 21/21 pass.

### Live end-to-end run (one market, 360 s, commit-first ordering proven live)
Synthetic demonstration job (labeled as such in the state file — the engine slate is 24 h markets; this run needed 360 s): Coinbase spot at start $68.98 → strike **$68.50**, probBps **6200**, model version `kernel-lr-v1`, LP deposit **10 mUSDC**. marketId **220999436532452** → market `3KhWpiKLmWt4DJn4EbBJfRFK5M68Dpz5yto8HKd7zvAu` (https://explorer.solana.com/address/3KhWpiKLmWt4DJn4EbBJfRFK5M68Dpz5yto8HKd7zvAu?cluster=devnet). The PredictionRecord PDA existed on-chain **before** the market did — ARCHITECTURE.md §2 ordering holds live, not just in the plan.

| Step | Signature (all finalized, err=null) | Slot |
|---|---|---|
| COMMIT `commit_prediction` | https://explorer.solana.com/tx/4Aij4CogZRm86iZ5p6HYNH2bwKVEXGaQdVmNjvUvvj3TSXCpVL1WrRaT7P1i51dnQZGMZUkiFTTEhMj4UHEruMnu?cluster=devnet | 524,449,937 |
| CREATE market (initializeMarket + depositLiquidity, same chosen id) | https://explorer.solana.com/tx/4oPQGst7kVKfjtVNKc9fdrBFbBwGXGsM75JweRdtkpNa15XhJgYd7qduiiS2T2hANYGWmoz6cRxfcsStfbFzvwBG?cluster=devnet | 524,449,954 |
| RESOLVE (YES) | https://explorer.solana.com/tx/3nnrriN6LakGULYCAWruFuYzbKzJTY15MQyQakcxN38KCqbzSSvPXeRAtAccCZPSSrwMgKshfo6XsrvQq9TZQbZf?cluster=devnet | 524,451,479 |
| ATTEST `attest_resolution` | https://explorer.solana.com/tx/bABje8SjXwXV5jJumFDiqJaMuytEC5KC8wT6BBSUPCa8KVSTz3J58vPwQVv5fZV8JQWjYYy81VYWD3yNifTrsAi?cluster=devnet | 524,451,610 |

- **Expiry read (documented Coinbase fallback, per the banked Step-3 finding):** the legacy Pyth devnet feed is stale and Hermes is unauthorized from this sandbox, so the outcome was derived from a Coinbase Exchange read at expiry — SOL **$68.58** (raw 6,858,000,000) vs strike $68.50 → **outcome YES**; the record's `pyth_price_account` is attested as the none sentinel (`11111111111111111111111111111111`) and the substitution is stated here and in the run state file. The stale feed was never presented as a live read.
- **PredictionRecord** `AJdwPfYkg3577B46VjPhAfVV7r1dnXryQkN5uEVquALq` — independent manual decode, every field verified: market = the market above; forecaster = tester; prediction_hash `5fb459a0…36b8a0` (recomputed from the keeper's documented formula sha256(market ‖ prob u16LE ‖ version ‖ issued_at i64LE) — match); model_prob_bps **6200**; model_version `kernel-lr-v1`; strike **6,850,000,000**; committed_at 1795201085 (before market creation); resolved = true; outcome_yes = true; observed_price **6,858,000,000**; observed_slot 524,451,475; attested_at 1795201487 (> committed_at, as the program requires); **brier_score_e8 = 14,440,000** — exactly the program's math for 6200 bps → YES, matching Step 1's unit + LiteSVM values; bump 252.
- **Runner cosmetic bug, root-caused and fixed:** the runner's own final print said "LIVE RUN FAILED: record decode consumed 205 of 225 bytes". Its decoder was correct; the strict full-buffer assertion was not — Anchor allocates `8 + INIT_SPACE` with the String field at its full 32-byte capacity, so a 12-char version serializes to 205 bytes inside the 225-byte account, leaving 20 zero padding bytes (independently confirmed: trailing 20 bytes all zero). The check in `liveRun.ts` now accepts trailing bytes only when they are all zero; tsc clean, 21/21 tests still green. No on-chain state was ever in doubt.

### Balance reconciliation (exact, from `getTransaction` pre/post balances + final `getBalance`)
SOL chain (lamports): 464,602,840 → +5,000,000,000 (Gio) → **5,464,602,840** → −1,089,878,280 (aborted CLI attempt: buffer funding 1,089,868,280 + create-buffer fee 10,000) → 4,374,724,560 → −1,918,120 (deploy script: 215 write fees 1,075,000 + deploy fee 10,000 + program account rent 833,120) → **4,372,806,440** → −1,798,240 (commit: record rent 1,793,240 + fee 5,000) → 4,371,008,200 → −35,382,160 (create, itemized below) → 4,335,626,040 → −5,000 (resolve fee) → 4,335,621,040 → −5,000 (attest fee) → **4,335,616,040 = current on-chain balance, exact match.**
- Create itemization (every lamport accounted): fee 5,000; market account rent 2,900,680 (443 B); LP position account rent 1,386,840 (145 B); two outcome-mint rents 1,066,800 ×2 (82 B); vault token account rent 1,488,440 (165 B); two Metaplex metadata accounts (607 B) 13,733,800 each = rent 3,733,800 + 10,000,000 program-funded lamports each. Credited total 35,377,160 + fee = 35,382,160 ✓.
- Total Step-3 fees burned: **1,115,000 lamports** (0.001115 SOL). Everything else spent is rent/account funding still held in accounts (programdata alone holds 1,089,868,280).
- mUSDC: 952.727492 → **942.727492** — exactly the 10 mUSDC LP deposit, which stays in the resolved market's vault; the keeper holds the LP position (no claim step in this run, by design — the registry cycle was the point of Step 3).

### Status after Step 3
- ForecastRegistry: **DEPLOYED to devnet and exercised end-to-end live** (commit-before-create, attestation, in-program Brier — all with explorer evidence). Keeper registry client live; dry-run path unchanged and still send-free.
- Still open (unchanged from Step 2): commitment-vault opening in the create step; real Pyth pull-oracle (PriceUpdateV2) posting at resolution instead of the Coinbase fallback; traction dashboard.
- Next per plan: Step 4 — demo app/UI (markets + on-chain Brier track record), then Step 5 — demo video + submission package (submit target Dec 3).

## Step 4 — 2026-11-21: demo app/UI built + smoke-verified ✅

The demo web app is built in `app/` and verified against live devnet data. Nothing deployed anywhere public; local build + render evidence is the deliverable. Read-only by design (no wallet, no sends) — the trading/vault UI from the original app plan remains future scope.

### Stack choice
- **Vite + React 19 + TypeScript** (the scaffold's Next.js manifest was replaced): a static SPA builds reliably in this sandbox in ~4 s, needs no server runtime, and everything the demo shows is client-rendered from chain data. Deps pinned to the keeper-proven versions (`@solana/web3.js ^1.95.0`, `@anchor-lang/core ^1.2.2`, `@pm-amm/sdk 0.2.0`); `npm install` = 149 packages, clean. `tsc --noEmit` clean; `vite build` succeeds (the pm-AMM SDK is a lazy chunk via dynamic import).

### What was built
- **Landing** — the concept in one screen: forecast-model-seeded pm-AMM markets with an on-chain, tamper-proof Brier track record; team name **Pasukan Satset**; badges (Solana Devnet / pm-AMM / ForecastRegistry); headline stats driven by the live data (predictions committed, resolved, aggregate Brier, baseline, market count).
- **Track record section** — reads **every PredictionRecord account** of the registry program `G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU` via `getProgramAccounts` over HTTPS RPC, decoded with the **Step-1 IDL** (`BorshAccountsCoder` on `forecast_registry::PredictionRecord`; the 225-byte allocation vs 205-byte serialization padding from Step 3 is tolerated — borsh reads field-by-field and the trailing zeros are ignored). Table: record + market (Explorer-linked), model prob (bps + %), strike, committed time, status, outcome, observed price, Brier (+ raw e8). Aggregate panel: **mean Brier 0.1444 vs the flat-50% baseline 0.2500 → 42.2% better** over the 1 resolved prediction (a flat-50% forecast scores exactly 0.25 on any outcome, so the baseline mean over the same set is 0.25 by construction).
- **Markets section** — the two known devnet pm-AMM markets (`3KhWpiKLmWt4DJn4EbBJfRFK5M68Dpz5yto8HKd7zvAu`, `9mxS9rrZekcwvFPVo1nVqqNxNiE9PExhuSvyqzh3Vxni`) read via `PmAmmClient.readOnly().fetchMarket`: on-chain names decoded ("FairOdds live: SOL above $68.50 in 6 min? (seed 62%)", "FairOdds smoke: SOL up in 5 min? (model seed 62%)"), both **resolved — YES won**, seed 6200 bps, open/end times, Explorer links.
- **How it works** — the five-step pipeline as cards: Engine → Commit → Seed → Resolve → Attest, including the honest devnet note (Coinbase-at-expiry read; the stale Pyth devnet feed is named, not hidden).

### Data route (stated plainly)
- The page renders `public/data.json` first, then attempts an **in-browser live refresh** (`src/lib/chain.ts`: same RPC reads, same IDL decode, same SDK market fetch) and labels the provenance on screen ("Live from Solana devnet" vs "Snapshot fetched live … by scripts/fetch-data.cjs").
- `public/data.json` is produced by **`scripts/fetch-data.cjs`** (`npm run fetch-data`) — the identical reads run in Node over HTTPS, which this sandbox permits. **That is the route the smoke evidence uses**: the sandbox's headless Chrome has **no external network egress at all** (verified directly: a headless navigation to https://api.devnet.solana.com returns an empty DOM), so the in-browser refresh reports "Failed to fetch" in the sandbox and the page correctly falls back to the live-fetched snapshot. On a normal network the same build refreshes live in-browser.

### Verification (all run 2026-11-21, this VM)
- **Live fetch — `npm run fetch-data`:** 1 record decoded (AJdwPfYkg3577B46VjPhAfVV7r1dnXryQkN5uEVquALq — prob 6200 bps, strike $68.50, resolved YES, observed $68.58, Brier 0.1444, mean Brier 0.1444 vs 0.25) + both markets resolved/YES/seed 6200. Output saved to `app/examples/fetch-data-output.txt`; dataset in `app/public/data.json`.
- **Build — `npm run build`:** success (dist: index.html + 3 assets, ~780 KB total pre-gzip); `npm run typecheck` clean.
- **Headless smoke — `npm run smoke`** (`scripts/smoke.cjs`: `vite preview` + headless Chrome `--dump-dom` + screenshot, `--virtual-time-budget`): **13/13 assertions PASS** — the rendered DOM contains the real record's 62.00% / 6200 bps / 0.1444 / e8 14440000, both market addresses + on-chain names, $68.50 strike, $68.58 observed, the 0.2500 baseline, and "Pasukan Satset"; provenance rendered = snapshot (see data-route note). Evidence: `app/examples/smoke-dom.html`, `app/examples/smoke-screenshot.png` (visually inspected: hero stats, Brier comparison bars, record table, both market cards all render correctly).

### Status after Step 4
- Demo app: **built and smoke-verified locally**; not hosted anywhere (hosting is a submission-package decision in Step 5 — the static `app/dist/` can be dropped onto any static host unchanged).
- Next per plan: Step 5 — demo video + submission package (submit target Dec 3). Still open (unchanged): commitment-vault opening in the create step; real Pyth pull-oracle posting at resolution; traction dashboard; the Dec 5 vs Dec 6 deadline confirmation from PLAN.md §5.

## Step 5 — 2026-11-21: demo video + submission package ✅ (final build step)

The submission package is complete in `submission/`. **Nothing was submitted and nothing was spent** — the form on hackathons.solana.com needs Gio's logged-in account (@sidik1702); everything below makes that a copy-paste job. Gio's remaining manual steps are listed precisely in `submission/SUBMISSION-CHECKLIST.md`.

### Deliverables (`fairodds/submission/`)
- **`WRITEUP.md`** — the full paste-ready submission text: pitch, problem/solution, how-it-works (engine → commit → seed → resolve → attest), why-pm-AMM, what-was-built table with every devnet explorer link (program `G4Gib3N2…`, record `AJdwPfYk…`, both markets, all Step-3 + Day-2 txs, deploy tx), the backtest stated honestly (model 0.1073 vs momentum 0.1464 vs base rate 0.1057 vs coin flip 0.2500 — **including the base-rate-tie caveat and the single-regime limitation**, framed as v1 evidence + roadmap), the fee-economics note (creator earns 1% of swap volume; effective 1% cost verified in our own Day-2 swap), a traction section that states the real numbers plainly (devnet demo, 2 markets, 1 graded cycle, zero real users/volume so far + the mechanical traction plan), and a PREDICT-fit section (pm-AMM as core, custom seed as the central mechanic, real measured model, creator-fee business model, contributions to known pm-AMM gaps, standalone potential). One ⚠️ placeholder: **the public GitHub repo URL** — no public repo exists yet (the code has no git remote); the PREDICT bounty requires one, so Gio must publish `fairodds/` under Sidik1702 (excluding keypairs — `.gitignore` already covers them) and paste the URL in before submitting.
- **`VIDEO-SCRIPT.md`** — the 8-segment English narration script (hook → problem → how-it-works → track record → on-chain evidence → markets → honest backtest → close) with the measured per-segment timings.
- **`demo-video.mp4`** — the finished demo video (details + verification below).
- **`SUBMISSION-CHECKLIST.md`** — Gio's exact manual steps: log in as @sidik1702; a field-by-field mapping (which form field gets which WRITEUP.md section); the video step (direct upload, or unlisted YouTube if the form wants a link); the repo prep item; **the profile wallet is NOT required** (winners are contacted by the Solana Foundation — and a warning: if any page asks for a signature or a fee, stop); the deadline ambiguity (site shows Dec 6, plan research said Dec 5 — **submit target stays Dec 3**, Dec 5 treated as the hard wall); and post-submit confirmation steps.
- **`video-assets/`** — all production assets (app captures, generated frames + their HTML sources, TTS segments, per-segment parts, check frames).

### Video production (all in-sandbox)
- **App frames:** fresh headless-Chrome full-page capture of the Step-4 app (`vite preview`, 1600 px wide), cropped per section (hero / how-it-works / track record / markets), scaled to 1920 wide and letterboxed onto the app's own `#0b0e17` background at 1920×1080. The Step-4 smoke screenshot was the layout reference; the captures used here are new renders of the same live-data build.
- **Generated frames:** title, Step-3 evidence (commit/create/resolve/attest with slots + shortened signatures + the record's fields), backtest (Brier bars + stat cards + the honest-finding note), and closing — HTML→PNG in the app's visual style, 1920×1080 native.
- **Voiceover:** `/opt/hatch/bin/tts speak --language en --voice avocado_v2:MAI_03`, one mp3 per script segment (19.9 / 27.9 / 37.9 / 34.3 / 26.7 / 26.2 / 34.8 / 18.2 s). Assembly: one ffmpeg segment per frame (still + its narration + 0.35 s tail, libx264 crf 20 / AAC 160k 48 kHz), concat demuxer, stream copy.
- **Incident, recovered cleanly:** a service restart mid-assembly truncated `part3.mp4` (28.23 s vs the required 38.27 s) and cut the concat short. Detected by per-part duration checks against the TTS measurements; parts 3–8 were rebuilt and each re-verified to the exact expected duration before the final concat. No part with a wrong duration entered the final file.

### Verification (2026-11-21, this VM)
- **ffprobe `submission/demo-video.mp4`:** duration **228.87 s (3:49 — under the 300 s cap)**, video h264 **1920×1080**, audio AAC 48 kHz mono, size 7,863,624 bytes.
- **Audio presence:** `volumedetect` over a narration window (t=30–45 s): mean −28.4 dB, max −7.6 dB — real speech, not silence.
- **Frame checks (extracted from the final mp4 and visually inspected):** t=5 s title frame (headline, gradient line, badges, hackathon footer all correct); t=100 s track-record frame (the real record: 62.00% / 6200 bps / $68.50 / $68.58 / Brier 0.1444 / e8 14440000, legible); t=190 s backtest frame (all four Brier bars + values, stat cards, honest-finding note, all legible).

### Status after Step 5
- **All build steps (1–5) are complete.** FairOdds is submission-ready: program live on devnet, one graded on-chain forecast cycle, demo app, demo video (3:49), paste-ready write-up, and a field-by-field checklist for Gio.
- **Waiting on Gio (only):** (1) publish the public GitHub repo + paste its URL into WRITEUP.md; (2) submit on hackathons.solana.com as @sidik1702 — **target Dec 3** (deadline Dec 5 per the live page vs Dec 6 per the earlier brief; never after Dec 5); (3) send Muse the confirmation screenshot.
- Still open (post-submission roadmap, unchanged): commitment-vault opening in the create step; Pyth PriceUpdateV2 posting at resolution (replacing the documented Coinbase fallback); daily live slate for traction; multi-regime backtest.

## Repo published — 2026-11-21 (~03:05 WIB)
- **Public repo:** https://github.com/Sidik1702/fairodds (Gio created the empty repo; Muse published the codebase). Initial commit `0f7d85d06f05f67ddcf14e80fc21948ecfb3afe7`, **120 files**. The ⚠️ repo-URL placeholder in `submission/WRITEUP.md` was filled with this URL before the first commit.
- **Keypair safety (asserted pre-push, verified post-push):** `.gitignore` covers `target/`, `node_modules/`, `.env*`, `*keypair*`, `*secret*`, `dist/`. Staged-file grep for `keypair|secret|.env` → no matches; `git ls-files | grep -i keypair` → empty (so `devnet-tester.keypair.json` and `target/deploy/forecast_registry-keypair.json` were NOT pushed). A fresh shallow clone was listed and `find -iname "*keypair*"` returned nothing; clone contained README, `submission/`, `programs/`, `keeper/`, `app/`, `forecast/` as expected. Temp clone deleted.
- Push route: `ssh://git@ssh.github.com:443/Sidik1702/fairodds.git` with the `gh-proxy-cmd.sh` ProxyCommand. (GitHub answered "repository moved … Sidik1702/Fairodds" — its canonical-casing redirect; the push landed and `ls-remote` confirms `main` = `0f7d85d…`.)
- `submission/SUBMISSION-CHECKLIST.md` prep step 1 marked done with the URL. Remaining for Gio: submit the form as @sidik1702 — target Dec 3, hard wall Dec 5.
