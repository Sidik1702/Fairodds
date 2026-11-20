# keeper/ — keeper bot

Responsibilities (PLAN.md §1/§3):

1. **Daily slate** — take the engine's proposed markets, call ForecastRegistry `commit_prediction` (hash on-chain *before* trading opens), then create each market on the pm-AMM via `@pm-amm/sdk` with `initialPriceBps` = model probability, and open its commitment vault.
2. **Resolution** — after expiry, read the Pyth price feed, post `attest_resolution` to ForecastRegistry, then drive pm-AMM resolution + claim flow.
3. **Traction dashboard** — aggregate users / trades / volume / fees from pm-AMM events; published for the frontend and quoted in the submission.

Rules: devnet over HTTPS RPC only (OrbitFlare free tier first, public devnet fallback); `simulateTransaction` before every send (see the `send.*` caveat in `src/pmamm.ts`); retries use fresh blockhashes; every lifecycle step is logged with its tx signature for explorer links. Sends are confirmed by polling `getSignatureStatuses` over HTTPS — the sandbox breaks websocket confirmations (BUILD-LOG Day-2 lesson).

## Step-2 skeleton status (2026-11-20)

The wiring exists and is verified in **dry-run** mode; nothing is sent.

```sh
npm install
npm test        # 21 unit tests: job building, instruction encoding, gates
npm run plan    # dry-run: full ordered plan for the engine's current slate
npm run plan -- --out examples/dry-run-output.txt
```

Layout:

| File | Role |
|---|---|
| `src/types.ts` | `SlateEntry` (engine output shape), `KeeperJob` (`{marketQuestion, strike, probBps, initialPriceBps, endTs, …}`) |
| `src/jobs.ts` | Pure logic: slate→job conversion + validation (registry bps/version caps, pm-AMM 1–99% seed band, 360 s duration floor), `predictionHash`, outcome derivation, Brier mirror |
| `src/slateSource.ts` | Forecast adapter: executes `forecast/slate.py` fresh; falls back to the existing `forecast/slate.json` and says so |
| `src/registry.ts` | ForecastRegistry client behind the `RegistryClient` interface. Instruction construction is byte-exact (anchor IDL coder + Step-1 IDL, PDA from program seeds); **sends throw `PendingDeployError` — the program is not deployed to devnet yet** |
| `src/pmamm.ts` | pm-AMM seed/resolve/claim: `planCreateMarket` (pure) + live functions gated on `{ live: true }`, all sends via `sendAndConfirmHttp` (settle2.cjs pattern) |
| `src/plan.ts` | Ordered plan builder/renderer: commit → create/seed → wait → resolve → attest, with simulated market/keeper keys and an illustrative outcome, all labeled as such |
| `src/cli.ts` | `plan` command (dry-run). `--live` is **refused** until the registry deploy lands — commit must precede create (ARCHITECTURE.md §2) |

Still open after Step 2: ForecastRegistry devnet deploy (unblocks registry sends + `--live`), commitment-vault opening in the create step, the real Pyth read at resolution (the plan currently derives the outcome from a labeled stand-in), and the traction dashboard.
