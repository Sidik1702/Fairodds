# FairOdds — Demo Video Script

- **File:** `demo-video.mp4` (1920×1080, English voiceover, total < 5:00 — target ≈ 4:00)
- **Voice:** `/opt/hatch/bin/tts speak --language en --voice avocado_v2:MAI_03`
- **Structure:** one narration segment per visual frame; each frame is shown for exactly its segment's audio length (+0.35 s tail). Segment durations below are the measured ffprobe values from the final build.

| # | Visual | Narration (exact TTS text) |
|---|---|---|
| 1 | Title frame | "Every prediction market opens with a guess. Most start at fifty-fifty and hope the crowd figures it out. FairOdds opens every market at a forecast — a calibrated probability from a real model, committed on-chain before anyone can trade, and graded on-chain when it resolves. This is FairOdds, by Pasukan Satset." |
| 2 | Demo app — hero | "Why does that matter? A market seeded at a coin flip is mispriced by construction: liquidity providers get picked off while the price crawls to fair value. And forecasters have no trustworthy track record — anyone can claim they called it, after the fact. FairOdds fixes both ends. The opening price is the model's fair price, and the model's whole history is written to Solana before outcomes are known. What you're looking at is our demo app, reading that record live from devnet." |
| 3 | Demo app — How it works | "Five steps. One: the forecast engine — a kernel-weighted comparables model — estimates the probability that SOL closes above a strike in twenty-four hours. Two: before trading opens, the keeper commits the prediction — market, probability, strike, model version, hash — into a ForecastRegistry record. One record per market; it can never be edited. Three: the pm-AMM market is created, seeded at the model's probability. Four: at expiry, the outcome is read from the reference price. Five: the keeper attests — and the program itself computes the Brier score." |
| 4 | Demo app — On-chain track record | "This is the track record page — and it's not our database. The app reads every PredictionRecord account directly from the ForecastRegistry program on devnet. Here's our first live record: the model said sixty-two percent that SOL would finish above sixty-eight fifty. It committed that at 18:58 UTC, before the market existed. SOL finished at sixty-eight fifty-eight — outcome YES — and the program scored it: Brier zero point one four four four, against the zero point two five a coin flip scores. Forty-two percent better, verifiable by anyone." |
| 5 | Live-run evidence frame | "And this run is fully on-chain. Commit, create, resolve, attest — four transactions, all finalized on devnet, each one linked in our submission. Note the order: the commitment transaction landed before the market was created. That's the whole point — the forecast provably predates the market it seeded. The registry program is deployed and executable on devnet, and its deployed bytecode hash matches the source we ship, byte for byte." |
| 6 | Demo app — Markets on devnet | "These are the markets themselves, live on the pm-AMM: created with custom seeds — sixty-two percent, not fifty — traded, resolved, and settled through the pm-AMM's own instructions. FairOdds never reimplements an AMM. Seeding, liquidity, swaps, and settlement all run on Paradigm's pm-AMM, because its uniform loss-versus-rebalancing design is what makes model-fair seeding survivable for liquidity providers." |
| 7 | Backtest frame | "Now the honest part — our backtest. Over six thousand three hundred walk-forward forecasts on a hundred and eighty days of SOL and BTC prices, the model's Brier score is zero point one zero seven — twenty-seven percent better than naive momentum, and fifty-seven percent better than a coin flip. But in this sample — one long downtrend — it only ties the unconditional base rate, and we say so in the report. Version one's claim is narrower and defensible: calibrated, fair seeds, with every future forecast graded in public, on-chain." |
| 8 | Closing frame | "FairOdds: prediction markets that open at a forecast, and a forecaster that can't hide from its record. Built end-to-end on the pm-AMM — custom seeds, creator-fee alignment, and a track record anyone can recompute from chain data alone. Thanks for watching — FairOdds, by Pasukan Satset." |

## Measured segment timings (final build, ffprobe)

| # | Segment audio | Shown (audio + 0.35 s) | Cumulative end |
|---|---|---|---|
| 1 | 19.920 s | 20.270 s | 0:20 |
| 2 | 27.888 s | 28.238 s | 0:49 |
| 3 | 37.920 s | 38.270 s | 1:27 |
| 4 | 34.272 s | 34.633 s | 2:01 |
| 5 | 26.712 s | 27.067 s | 2:28 |
| 6 | 26.208 s | 26.567 s | 2:55 |
| 7 | 34.848 s | 35.200 s | 3:30 |
| 8 | 18.240 s | 18.600 s | 3:49 |

**Final file: 228.87 s (3:49)**, 1920×1080 h264 + AAC 48 kHz, 7.86 MB.

## Production notes

- App frames are fresh headless-Chrome captures of the Step-4 demo app (`app/dist/` via `vite preview`), cropped per section from a 1600 px-wide full-page render.
- The evidence and backtest frames are generated HTML→PNG cards in the app's visual style (dark navy `#070b16`, green accent `#2ee6a8`, purple `#8b5cf6`).
- Assembly: ffmpeg, one segment per frame (still image + its TTS mp3, `libx264`/`aac`, 1920×1080), concatenated with the concat demuxer. Verified with ffprobe + extracted frames (see BUILD-LOG Step 5).
