import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  deriveOutcomeYes,
  expectedBrierE8,
  jobFromSlateEntry,
  predictionHash,
  usdToRaw,
} from "../src/jobs.js";
import type { SlateEntry } from "../src/types.js";

/** The real SOL entry from forecast/slate.json (2026-11-20 engine run). */
const SOL_ENTRY: SlateEntry = {
  asset: "SOL",
  question: "Will SOL close above $67.00 in 24h?",
  strike: 67.0,
  spot: 68.52,
  model_probability: 0.7545,
  initial_price_bps: 7545,
  duration_secs: 86400,
  opens_at: 1795191549,
  expires_at: 1795277949,
  comparables_ess: 13.3,
  data_source: "live Coinbase fetch",
};

test("jobFromSlateEntry builds a complete keeper job", () => {
  const job = jobFromSlateEntry(SOL_ENTRY);
  assert.equal(job.marketQuestion, "Will SOL close above $67.00 in 24h?");
  assert.equal(job.asset, "SOL");
  assert.equal(job.strike, 67.0);
  assert.equal(job.probBps, 7545);
  assert.equal(job.initialPriceBps, 7545); // seed == model probability
  assert.equal(job.endTs, 1795277949);
  assert.equal(job.opensAt, 1795191549);
  assert.equal(job.durationSecs, 86400);
  assert.equal(job.modelVersion, "kernel-lr-v1");
});

test("usdToRaw converts USD to Pyth-style raw units (exponent -8)", () => {
  assert.equal(usdToRaw(67.0), 6_700_000_000n);
  assert.equal(usdToRaw(68.52), 6_852_000_000n);
  assert.equal(usdToRaw(58050.0), 5_805_000_000_000n);
  assert.equal(jobFromSlateEntry(SOL_ENTRY).strikeRaw, 6_700_000_000n);
});

test("jobFromSlateEntry rejects probabilities outside the pm-AMM seed band", () => {
  const low = { ...SOL_ENTRY, model_probability: 0.005, initial_price_bps: 50 };
  assert.throws(() => jobFromSlateEntry(low), /outside the pm-AMM custom-seed band/);
  const high = { ...SOL_ENTRY, model_probability: 0.995, initial_price_bps: 9950 };
  assert.throws(() => jobFromSlateEntry(high), /outside the pm-AMM custom-seed band/);
  const edge = { ...SOL_ENTRY, model_probability: 0.99, initial_price_bps: 9900 };
  assert.equal(jobFromSlateEntry(edge).probBps, 9900); // 99% is allowed
});

test("jobFromSlateEntry rejects slate inconsistencies and bad inputs", () => {
  assert.throws(
    () => jobFromSlateEntry({ ...SOL_ENTRY, initial_price_bps: 7500 }),
    /slate inconsistency: initial_price_bps/,
  );
  assert.throws(() => jobFromSlateEntry({ ...SOL_ENTRY, strike: 0 }), /strike must be positive/);
  assert.throws(
    () => jobFromSlateEntry({ ...SOL_ENTRY, expires_at: SOL_ENTRY.expires_at + 1 }),
    /slate inconsistency: expires_at/,
  );
});

test("jobFromSlateEntry enforces the duration rule (360s floor per the Day-2 lesson)", () => {
  const at300 = {
    ...SOL_ENTRY,
    duration_secs: 300,
    expires_at: SOL_ENTRY.opens_at + 300,
  };
  assert.throws(() => jobFromSlateEntry(at300), /duration_secs 300 outside/);
  const at360 = {
    ...SOL_ENTRY,
    duration_secs: 360,
    expires_at: SOL_ENTRY.opens_at + 360,
  };
  assert.equal(jobFromSlateEntry(at360).durationSecs, 360);
  const tooLong = {
    ...SOL_ENTRY,
    duration_secs: 31 * 24 * 3600,
    expires_at: SOL_ENTRY.opens_at + 31 * 24 * 3600,
  };
  assert.throws(() => jobFromSlateEntry(tooLong), /duration_secs .* outside/);
});

test("jobFromSlateEntry enforces the registry's 32-byte model-version cap", () => {
  assert.throws(
    () => jobFromSlateEntry(SOL_ENTRY, { modelVersion: "v".repeat(33) }),
    /exceeds the registry's 32-byte cap/,
  );
  assert.equal(
    jobFromSlateEntry(SOL_ENTRY, { modelVersion: "v".repeat(32) }).modelVersion.length,
    32,
  );
});

test("predictionHash is 32 bytes, deterministic, and input-sensitive", () => {
  const market = new PublicKey("9mxS9rrZekcwvFPVo1nVqqNxNiE9PExhuSvyqzh3Vxni");
  const h1 = predictionHash(market, 7545, "kernel-lr-v1", 1795191549);
  assert.equal(h1.length, 32);
  assert.deepEqual(predictionHash(market, 7545, "kernel-lr-v1", 1795191549), h1);
  assert.notDeepEqual(predictionHash(market, 7546, "kernel-lr-v1", 1795191549), h1);
  assert.notDeepEqual(predictionHash(market, 7545, "kernel-lr-v2", 1795191549), h1);
  assert.notDeepEqual(predictionHash(market, 7545, "kernel-lr-v1", 1795191550), h1);
  const other = new PublicKey("6c1eJRKMymbts1wPK5yxDPBg9ZXcdXRVVRmFGVhNTHFH");
  assert.notDeepEqual(predictionHash(other, 7545, "kernel-lr-v1", 1795191549), h1);
});

test("deriveOutcomeYes: YES iff observed price is strictly above the strike", () => {
  assert.equal(deriveOutcomeYes(6_852_000_000n, 6_700_000_000n), true);
  assert.equal(deriveOutcomeYes(6_700_000_000n, 6_700_000_000n), false); // at strike = NO
  assert.equal(deriveOutcomeYes(6_600_000_000n, 6_700_000_000n), false);
});

test("expectedBrierE8 mirrors the registry program's in-program math (Step 1 values)", () => {
  assert.equal(expectedBrierE8(6200, true), 14_440_000n); // 62% seed, YES
  assert.equal(expectedBrierE8(6200, false), 38_440_000n); // 62% seed, NO
  assert.equal(expectedBrierE8(5000, true), 25_000_000n); // flat-50 baseline
  assert.equal(expectedBrierE8(5000, false), 25_000_000n);
  assert.equal(expectedBrierE8(10000, true), 0n);
  assert.equal(expectedBrierE8(0, true), 100_000_000n);
});
