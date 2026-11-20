# app/ — FairOdds frontend (Next.js)

Pages planned (PLAN.md §1, Concept A; build slot Nov 23–25):

- **Market list** — every live market with a "model price vs market price" edge meter.
- **Market page** — live price chart (from pm-AMM state), one-click trade via `@pm-amm/sdk` (`PmAmmClient`), resolution proof link.
- **Vault commit flow** — commit USDC into a market's commitment vault; committers become LPs at launch.
- **Forecaster leaderboard** — per-category Brier score + calibration chart, with prediction-hash verification links to the ForecastRegistry program.
- **Traction dashboard** (also keeper-fed) — users / trades / volume / fees from pm-AMM events; this is the PREDICT bounty judges' #1 criterion.

Wallet connect via Solana wallet adapter (to wire in the Nov 23 slot). All sends are simulate-first.

---

## Step 4 (2026-11-21) — demo v1 BUILT (read-only)

The Nov 23 frontend slot landed early as a **read-only demo** (Vite + React, chosen over Next.js for a reliable static build in this sandbox; no wallet, no trading UI — those remain future scope from the plan above).

- **Landing** — the FairOdds concept (model-seeded pm-AMM markets + tamper-proof on-chain Brier track record), "Pasukan Satset" team credit, devnet badges, live headline stats.
- **On-chain track record** — every `PredictionRecord` of the ForecastRegistry program (`G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU`), decoded with the Step-1 IDL, with the aggregate Brier vs the flat-50% baseline (0.25). Renders the real Step-3 record (62.00%, Brier 0.1444).
- **Markets** — the known devnet pm-AMM markets with live state (both currently: resolved, YES won), Explorer-linked.
- **How it works** — engine → commit → seed → resolve → attest.

Data route: the page renders `public/data.json` (produced LIVE from devnet by `npm run fetch-data` → `scripts/fetch-data.cjs`: `getProgramAccounts` + IDL decode + `PmAmmClient.fetchMarket`), then attempts an in-browser live refresh over HTTPS RPC (`src/lib/chain.ts`) and labels which provenance is on screen. In this sandbox the headless browser has no external egress, so the smoke render uses the snapshot route; the live-refresh code path is the same libraries/reads the Node fetch proves.

Commands: `npm run fetch-data` → `npm run build` → `npm run smoke` (headless-Chrome render check; evidence in `examples/`: `smoke-screenshot.png`, `smoke-dom.html`, `fetch-data-output.txt`). Serve locally with `npm run preview`. Not deployed anywhere public.
