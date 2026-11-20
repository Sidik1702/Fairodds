# FairOdds — Submission Checklist for Gio (hackathons.solana.com)

Everything is prepared in this folder (`fairodds/submission/`). The steps below are the ones only **you** can do, because the submission must go through your logged-in account **@sidik1702**. Nothing here costs money. **Do not submit before Dec 3 unless we agree to move the target — and never after Dec 5.**

## ⚠️ Deadline — read this first

- The live hackathon page has shown **"Deadline Dec 5, 2026"**, while our earlier brief said **Dec 6**. The discrepancy was never resolved.
- **Our submit target stays Dec 3, 2026** (evening WIB is fine) — safe under either reading. Treat **Dec 5 as the hard wall**. If you open the site and it clearly shows Dec 6 with a time, we gain a buffer day — we do not spend it by slipping the target.

## Before you open the form (2 prep items)

1. ✅ **DONE (2026-11-21) — Public GitHub repo:** **https://github.com/Sidik1702/fairodds** (published by Muse from the VM; initial commit `0f7d85d`, 120 files). Keypair safety was asserted before pushing (`.gitignore` covers `*keypair*`, `*secret*`, `.env*`, `target/`, `node_modules/`; `git ls-files | grep -i keypair` empty; a fresh clone was verified to contain no keypair files). The URL is already filled into `WRITEUP.md` — just paste it into the form's repository field (step 3).
2. **Demo video hosting.** The submission folder contains `demo-video.mp4` (< 5 min). If the form asks for a video **link** instead of an upload, upload the file to your YouTube as **unlisted** and use that link. If it accepts a file upload, upload `demo-video.mp4` directly. (Do not re-record anything — the file is final.)

## The form, field by field

Log in at **hackathons.solana.com** as **@sidik1702**, open the *Perps & Prediction Markets* event, and start/edit our project submission. Fill each field from `WRITEUP.md` as mapped here:

| Form field (typical) | What to put |
|---|---|
| **Project name** | `FairOdds` |
| **Team name** | `Pasukan Satset` |
| **Tagline / one-liner** | The **One-line pitch** from WRITEUP.md: "Polymarket starts every market at a guess. FairOdds starts every market at a forecast — seeded into Paradigm's pm-AMM at a model's calibrated fair price, committed on-chain before trading opens, and graded on-chain when it resolves." (If the field is short, use only the first sentence.) |
| **Description / About** | Paste from WRITEUP.md in this order: **The problem** → **The solution** → **How it works** → **Why the pm-AMM…** (If there are separate "Problem" and "Solution" fields, split at those headings.) |
| **What was built / technical description** | The **What was built** table + **The live end-to-end run** section (keep the explorer links — they are the proof). |
| **GitHub / repository link** | The public repo URL from prep step 1. |
| **Demo video** | Upload `demo-video.mp4`, or paste the unlisted YouTube link (prep step 2). |
| **Live demo / website link** (if present) | Optional: only if we host `app/dist/` somewhere static before submitting. If the field exists and is optional, it is safe to leave blank — the video shows the app reading live devnet data. If it is **required**, tell Muse — the static build can be dropped onto any static host unchanged. |
| **Track selection** | Select the **main track** (Perps & Prediction Markets) **and** the sponsor bounty **"Best use of the pm-AMM" by PREDICT**. (The form reportedly allows up to three sponsor tracks; we only claim PREDICT — do not select bounties we didn't build for.) |
| **Additional info / anything else** (if present) | Paste the **Backtest results** section (including the honest base-rate caveat), the **Fee economics** section, and the **Why FairOdds fits the PREDICT pm-AMM bounty** section. If space is tight, priority order: PREDICT-fit section → fee economics → backtest. |
| **Program IDs / addresses** (if present) | ForecastRegistry (devnet): `G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU` · pm-AMM: `GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y` · PredictionRecord: `AJdwPfYkg3577B46VjPhAfVV7r1dnXryQkN5uEVquALq` |

## Things you do NOT need to do

- **Profile wallet: NOT required.** Your hackathons.solana.com profile wallet shows "Not set" — leave it. Winners are contacted by the Solana Foundation; no wallet connection or signature is needed to register or submit, and **you should not connect a wallet or sign anything as part of this submission**. If any page asks you to sign a transaction or pay a fee to submit, **stop and tell Muse** — that is not part of this flow.
- **No payment of any kind.** Submission is free. (The PREDICT prize is a $1,000 *investment* via Spark if we win — paperwork comes later, only if contacted.)
- **No mainnet anything.** Everything in this submission is devnet, mock USDC. The mainnet go/no-go is a separate decision for later.

## After you click Submit

1. Screenshot the confirmation page and send it to Muse.
2. Muse will archive the confirmation, verify every link in the submitted text resolves from a clean session, and log the submission in the build log.
3. Keep the daily devnet slate plan in mind: if the team keeps running markets after submission, traction numbers keep growing into judging — no action needed from you unless Muse flags a decision.

## If something on the form doesn't match this checklist

Field names on the live form may differ slightly from the mapping above. If a required field appears that this checklist doesn't cover (e.g., a logo upload, a character limit that truncates the description, a mandatory live-demo URL), **don't improvise** — screenshot it and ask Muse; the write-up can be trimmed/reformatted to fit without losing the proof links.
