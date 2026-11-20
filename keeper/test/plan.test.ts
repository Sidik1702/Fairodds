import assert from "node:assert/strict";
import { test } from "node:test";
import { jobFromSlateEntry } from "../src/jobs.js";
import { PHASE_ORDER, buildJobPlan, simulatedKey } from "../src/plan.js";
import {
  DryRunOnlyError,
  claimWinnings,
  createSeededMarket,
  planCreateMarket,
  resolveMarket,
} from "../src/pmamm.js";
import { predictionPda } from "../src/registry.js";
import type { SlateEntry } from "../src/types.js";

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
};
const JOB = jobFromSlateEntry(SOL_ENTRY);
const KEEPER = simulatedKey("keeper");
const OPTS = { depositUsdc: 50, issuedAt: 1795191600, keeper: KEEPER };

test("buildJobPlan returns the five phases in pipeline order", () => {
  const steps = buildJobPlan(JOB, OPTS);
  assert.deepEqual(
    steps.map((s) => s.phase),
    [...PHASE_ORDER],
  );
});

test("commit step carries the real hash, PDA and parameters for the job", () => {
  const steps = buildJobPlan(JOB, OPTS);
  const commit = steps[0].detail as any;
  const market = simulatedKey(`market:${JOB.marketQuestion}`);
  assert.equal(commit.market_simulated, market.toBase58());
  assert.equal(commit.prediction_record_pda, predictionPda(market)[0].toBase58());
  assert.match(commit.prediction_hash_sha256, /^[0-9a-f]{64}$/);
  assert.equal(commit.model_prob_bps, 7545);
  assert.equal(commit.strike_raw, "6700000000");
  assert.match(commit.status, /PENDING-DEPLOY/);
  assert.equal(commit.instruction.programId, "G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU");
  assert.equal(commit.instruction.keys[1].pubkey, KEEPER.toBase58());
  assert.equal(commit.instruction.keys[1].signer, true);
});

test("create step seeds the pm-AMM market at the model probability", () => {
  const steps = buildJobPlan(JOB, OPTS);
  const create = steps[1].detail as any;
  assert.deepEqual(create.params, {
    name: JOB.marketQuestion,
    durationSecs: 86400,
    initialPriceBps: 7545,
    depositUsdc: 50,
  });
});

test("wait step targets the job's endTs; attest step shows the illustrative outcome + Brier", () => {
  const steps = buildJobPlan(JOB, OPTS);
  const wait = steps[2].detail as any;
  assert.equal(wait.endTs, JOB.endTs);
  const resolve = steps[3].detail as any;
  // Slate spot $68.52 > strike $67.00, so the illustrative outcome is YES.
  assert.equal(resolve.outcome_yes_illustrative, true);
  const attest = steps[4].detail as any;
  assert.equal(attest.outcome_yes_illustrative, true);
  // (7545 - 10000)^2 = 2455^2 = 6,027,025 (Brier x1e8).
  assert.equal(attest.expected_brier_e8_if_outcome, "6027025");
  assert.equal(attest.instruction.keys.length, 2);
});

test("simulatedKey is deterministic per label", () => {
  assert.equal(simulatedKey("keeper").toBase58(), simulatedKey("keeper").toBase58());
  assert.notEqual(simulatedKey("keeper").toBase58(), simulatedKey("market:x").toBase58());
});

test("planCreateMarket rejects a non-positive deposit", () => {
  assert.throws(() => planCreateMarket(JOB, 0), /depositUsdc must be positive/);
  assert.equal(planCreateMarket(JOB, 50).initialPriceBps, JOB.probBps);
});

test("pm-AMM live functions refuse to run without live mode", async () => {
  const dummy: any = {};
  await assert.rejects(
    createSeededMarket(dummy, dummy, JOB, 50, { live: false }),
    DryRunOnlyError,
  );
  await assert.rejects(
    resolveMarket(dummy, dummy, simulatedKey("m"), true, { live: false }),
    DryRunOnlyError,
  );
  await assert.rejects(claimWinnings(dummy, dummy, simulatedKey("m"), { live: false }), DryRunOnlyError);
});
