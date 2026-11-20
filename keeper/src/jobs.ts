/**
 * Pure job-building and parameter logic for the FairOdds keeper.
 *
 * Everything in this module is a pure function (no I/O, no network) so it
 * can be unit-tested directly — see test/jobs.test.ts. The on-chain
 * constraints mirrored here come from:
 *   - programs/forecast-registry/src/lib.rs (prob <= 10_000 bps,
 *     model_version <= 32 bytes, Brier = (prob_bps - outcome*10_000)^2),
 *   - PLAN.md §0 (pm-AMM custom seed prices are 1–99%),
 *   - the pm-AMM program's market-duration rule (300 s <= d <= 30 days;
 *     BUILD-LOG Day-2 lesson: exactly 300 s fails in practice because the
 *     effective duration lands a hair under the minimum by execution time,
 *     so the keeper enforces a 360 s floor).
 */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import type { KeeperJob, SlateEntry } from "./types.js";

/** Model version tag committed on-chain (registry caps it at 32 bytes). */
export const DEFAULT_MODEL_VERSION = "kernel-lr-v1";
export const MAX_MODEL_VERSION_LEN = 32;

/** Registry bound: model probability must be within 0..=10_000 bps. */
export const REGISTRY_MAX_PROB_BPS = 10_000;
/** pm-AMM bound: custom seed prices are 1–99% (PLAN.md §0). */
export const PMAMM_SEED_MIN_BPS = 100;
export const PMAMM_SEED_MAX_BPS = 9_900;

/** pm-AMM duration rule, with the Day-2 lesson applied (360 s floor). */
export const MIN_DURATION_SECS = 360;
export const MAX_DURATION_SECS = 30 * 24 * 3600;

/**
 * Pyth price feeds for SOL/USD and BTC/USD publish with exponent -8, so a
 * USD price converts to the registry's raw integer units by x10^8.
 */
export const RAW_PER_USD = 100_000_000n;

/** Convert a USD price to Pyth-style raw integer units (exponent -8). */
export function usdToRaw(usd: number): bigint {
  if (!Number.isFinite(usd)) throw new Error(`usdToRaw: non-finite price ${usd}`);
  return BigInt(Math.round(usd * 1e8));
}

/**
 * Validate a slate entry and turn it into a keeper job.
 * Throws with a precise message on the first violated constraint — a job
 * that cannot be committed or seeded must never reach the plan.
 */
export function jobFromSlateEntry(
  entry: SlateEntry,
  opts: { modelVersion?: string } = {},
): KeeperJob {
  const modelVersion = opts.modelVersion ?? DEFAULT_MODEL_VERSION;
  if (Buffer.byteLength(modelVersion, "utf8") > MAX_MODEL_VERSION_LEN) {
    throw new Error(
      `model version "${modelVersion}" exceeds the registry's ${MAX_MODEL_VERSION_LEN}-byte cap`,
    );
  }
  if (!entry.question || typeof entry.question !== "string") {
    throw new Error("slate entry is missing its question");
  }
  if (!(entry.strike > 0)) {
    throw new Error(`strike must be positive, got ${entry.strike}`);
  }
  const probBps = Math.round(entry.model_probability * 10_000);
  if (entry.initial_price_bps !== probBps) {
    throw new Error(
      `slate inconsistency: initial_price_bps ${entry.initial_price_bps} != round(model_probability*10000) ${probBps}`,
    );
  }
  if (probBps > REGISTRY_MAX_PROB_BPS) {
    throw new Error(`probBps ${probBps} exceeds the registry bound ${REGISTRY_MAX_PROB_BPS}`);
  }
  if (probBps < PMAMM_SEED_MIN_BPS || probBps > PMAMM_SEED_MAX_BPS) {
    throw new Error(
      `probBps ${probBps} outside the pm-AMM custom-seed band ${PMAMM_SEED_MIN_BPS}..=${PMAMM_SEED_MAX_BPS} (1-99%)`,
    );
  }
  if (entry.duration_secs < MIN_DURATION_SECS || entry.duration_secs > MAX_DURATION_SECS) {
    throw new Error(
      `duration_secs ${entry.duration_secs} outside ${MIN_DURATION_SECS}..=${MAX_DURATION_SECS}`,
    );
  }
  if (entry.expires_at !== entry.opens_at + entry.duration_secs) {
    throw new Error(
      `slate inconsistency: expires_at ${entry.expires_at} != opens_at + duration_secs ${entry.opens_at + entry.duration_secs}`,
    );
  }
  return {
    marketQuestion: entry.question,
    asset: entry.asset,
    strike: entry.strike,
    strikeRaw: usdToRaw(entry.strike),
    probBps,
    initialPriceBps: probBps,
    opensAt: entry.opens_at,
    endTs: entry.expires_at,
    durationSecs: entry.duration_secs,
    modelVersion,
    spotAtSlate: entry.spot,
  };
}

/**
 * The prediction commitment hash, exactly as documented in the registry
 * program: sha256( market_pubkey || model_prob_bps (u16 LE)
 *                  || model_version (utf8) || issued_at (i64 LE) ).
 * `issuedAt` is the unix timestamp at which the keeper issues the commit —
 * the same value the dry-run plan prints.
 */
export function predictionHash(
  market: PublicKey,
  probBps: number,
  modelVersion: string,
  issuedAt: number,
): Buffer {
  const h = createHash("sha256");
  h.update(market.toBuffer());
  const bps = Buffer.alloc(2);
  bps.writeUInt16LE(probBps, 0);
  h.update(bps);
  h.update(Buffer.from(modelVersion, "utf8"));
  const ts = Buffer.alloc(8);
  ts.writeBigInt64LE(BigInt(issuedAt), 0);
  h.update(ts);
  return h.digest();
}

/**
 * Outcome derivation (ARCHITECTURE.md §4): score = price - strike;
 * YES wins iff the observed price at expiry is strictly above the strike.
 * Both prices are raw Pyth-style integers (see usdToRaw).
 */
export function deriveOutcomeYes(observedPriceRaw: bigint, strikeRaw: bigint): boolean {
  return observedPriceRaw > strikeRaw;
}

/**
 * The Brier contribution the registry program will compute in-program for
 * this prediction, scaled by 1e8: (prob_bps - outcome*10_000)^2.
 * Mirrors compute_brier_e8 in programs/forecast-registry/src/lib.rs so the
 * keeper can show the expected score before attesting.
 */
export function expectedBrierE8(probBps: number, outcomeYes: boolean): bigint {
  const outcomeBps = outcomeYes ? 10_000n : 0n;
  const diff = BigInt(probBps) - outcomeBps;
  return diff * diff;
}
