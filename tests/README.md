# tests/ — test harness

Environment constraint (PLAN.md §4): this VM's sandbox **blocks UDP**, so `solana-test-validator` cannot run locally. The harness is therefore:

- **Rust unit tests** inside `programs/forecast-registry/` (`cargo test`).
- **LiteSVM / Mollusk in-process SVM tests** for ForecastRegistry instruction flows (commit → attest, double-commit rejection, attest-before-commit rejection, wrong-keeper rejection) — no validator, no UDP.
- **Devnet integration** is exercised through `scripts/` + keeper flows against the real pm-AMM deployment over HTTPS RPC, never against a local copy of pm-AMM.

Test files land in the Nov 22 slot alongside the ForecastRegistry implementation.
