/**
 * Dry-run plan builder + renderer.
 *
 * A plan is the full ordered pipeline for each keeper job:
 *   1. COMMIT   — ForecastRegistry commit_prediction (before trading opens)
 *   2. CREATE   — pm-AMM createMarket, custom seed = model probability
 *   3. WAIT     — until the market's endTs
 *   4. RESOLVE  — pm-AMM resolveMarket with the Pyth-derived outcome
 *   5. ATTEST   — ForecastRegistry attest_resolution (Brier computed in-program)
 *
 * Dry-run specifics, stated plainly so the evidence is not over-read:
 *   - The pm-AMM market does not exist yet, so COMMIT is shown against a
 *     deterministic SIMULATED market key (sha256 of the question). Every
 *     derived value printed from it — prediction hash, PredictionRecord
 *     PDA, encoded instruction bytes — is the real computation; at live
 *     run time the created market's real PDA replaces the stand-in.
 *   - RESOLVE/ATTEST are shown with an ILLUSTRATIVE outcome: the slate's
 *     spot price standing in for the expiry observation. The live keeper
 *     substitutes the real Pyth read at endTs (ARCHITECTURE.md §4).
 *   - The keeper signer is a SIMULATED key for the same reason (no keeper
 *     keypair exists until the wallet step); instruction account metas use
 *     it as the `keeper` signer.
 */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  deriveOutcomeYes,
  expectedBrierE8,
  predictionHash,
  usdToRaw,
} from "./jobs.js";
import { planCreateMarket } from "./pmamm.js";
import {
  describeInstruction,
  predictionPda,
  ForecastRegistryClient,
  REGISTRY_PROGRAM_ID,
} from "./registry.js";
import type { KeeperJob } from "./types.js";

/** Deterministic stand-in keys for dry-run display (never used on-chain). */
export function simulatedKey(label: string): PublicKey {
  return new PublicKey(createHash("sha256").update(`fairodds/dry-run:${label}`).digest());
}

export type PlanStep =
  | { phase: "commit"; job: KeeperJob; detail: Record<string, unknown> }
  | { phase: "create"; job: KeeperJob; detail: Record<string, unknown> }
  | { phase: "wait"; job: KeeperJob; detail: Record<string, unknown> }
  | { phase: "resolve"; job: KeeperJob; detail: Record<string, unknown> }
  | { phase: "attest"; job: KeeperJob; detail: Record<string, unknown> };

export const PHASE_ORDER = ["commit", "create", "wait", "resolve", "attest"] as const;

export interface PlanOptions {
  depositUsdc: number;
  /** Commit issuance time (unix seconds) fed into the prediction hash. */
  issuedAt: number;
  keeper: PublicKey;
  registry?: ForecastRegistryClient;
}

/** Build the ordered plan steps for one job. Pure given a registry client. */
export function buildJobPlan(job: KeeperJob, opts: PlanOptions): PlanStep[] {
  const registry = opts.registry ?? new ForecastRegistryClient();
  const market = simulatedKey(`market:${job.marketQuestion}`);
  const hash = predictionHash(market, job.probBps, job.modelVersion, opts.issuedAt);
  const [pda, bump] = predictionPda(market);

  const commitIx = registry.buildCommitInstruction({
    market,
    predictionHash: hash,
    modelProbBps: job.probBps,
    modelVersion: job.modelVersion,
    strikeRaw: job.strikeRaw,
    keeper: opts.keeper,
  });

  // Illustrative resolution: slate spot stands in for the expiry Pyth read.
  const observedRaw = usdToRaw(job.spotAtSlate);
  const outcomeYes = deriveOutcomeYes(observedRaw, job.strikeRaw);
  const pythAccount = simulatedKey(`pyth:${job.asset}`);
  const attestIx = registry.buildAttestInstruction({
    market,
    outcomeYes,
    pythPriceAccount: pythAccount,
    observedPriceRaw: observedRaw,
    observedSlot: 0n, // filled with the real slot at live resolution time
    keeper: opts.keeper,
  });

  const create = planCreateMarket(job, opts.depositUsdc);

  return [
    {
      phase: "commit",
      job,
      detail: {
        program: REGISTRY_PROGRAM_ID.toBase58(),
        status: "PENDING-DEPLOY (instruction built exactly; send gated)",
        market_simulated: market.toBase58(),
        prediction_record_pda: pda.toBase58(),
        pda_bump: bump,
        prediction_hash_sha256: hash.toString("hex"),
        hash_inputs: `sha256(market || prob_bps u16LE=${job.probBps} || model_version="${job.modelVersion}" || issued_at i64LE=${opts.issuedAt})`,
        model_prob_bps: job.probBps,
        model_version: job.modelVersion,
        strike_raw: job.strikeRaw.toString(),
        instruction: describeInstruction(commitIx),
      },
    },
    {
      phase: "create",
      job,
      detail: {
        program: "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y (pm-AMM)",
        sdk_call: "client.send.createMarket",
        params: create,
        note: "custom seed: the market opens at the model's fair price, not 50%",
      },
    },
    {
      phase: "wait",
      job,
      detail: {
        opens_at: job.opensAt,
        endTs: job.endTs,
        endTs_iso: new Date(job.endTs * 1000).toISOString(),
        duration_secs: job.durationSecs,
      },
    },
    {
      phase: "resolve",
      job,
      detail: {
        program: "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y (pm-AMM)",
        sdk_call: `client.send.resolveMarket(market, "${outcomeYes ? "yes" : "no"}")`,
        outcome_basis:
          "ILLUSTRATIVE in dry-run: outcome derived from the slate spot as a stand-in " +
          "for the Pyth read at expiry (YES iff observed price > strike)",
        strike_raw: job.strikeRaw.toString(),
        observed_raw_illustrative: observedRaw.toString(),
        outcome_yes_illustrative: outcomeYes,
      },
    },
    {
      phase: "attest",
      job,
      detail: {
        program: REGISTRY_PROGRAM_ID.toBase58(),
        status: "PENDING-DEPLOY (instruction built exactly; send gated)",
        market_simulated: market.toBase58(),
        prediction_record_pda: pda.toBase58(),
        outcome_yes_illustrative: outcomeYes,
        pyth_price_account_simulated: pythAccount.toBase58(),
        observed_price_raw_illustrative: observedRaw.toString(),
        observed_slot: "0 in dry-run (real slot filled at live resolution)",
        expected_brier_e8_if_outcome: expectedBrierE8(job.probBps, outcomeYes).toString(),
        brier_note: "Brier x1e8, computed in-program at attestation; flat-50% baseline = 25000000",
        instruction: describeInstruction(attestIx),
      },
    },
  ];
}

const PHASE_TITLES: Record<string, string> = {
  commit: "COMMIT   ForecastRegistry.commit_prediction — before trading opens",
  create: "CREATE   pm-AMM createMarket — custom seed = model probability",
  wait: "WAIT     until market endTs",
  resolve: "RESOLVE  pm-AMM resolveMarket — outcome from the Pyth read at expiry",
  attest: "ATTEST   ForecastRegistry.attest_resolution — Brier computed in-program",
};

function renderDetail(detail: Record<string, unknown>, indent: string): string[] {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(detail)) {
    if (k === "instruction" && typeof v === "object" && v !== null) {
      const ix = v as ReturnType<typeof describeInstruction>;
      lines.push(`${indent}instruction.program: ${ix.programId}`);
      for (const key of ix.keys) {
        lines.push(
          `${indent}instruction.key: ${key.pubkey} (signer=${key.signer}, writable=${key.writable})`,
        );
      }
      lines.push(`${indent}instruction.data: ${ix.dataLength} bytes`);
      lines.push(`${indent}instruction.data_hex: ${ix.dataHex}`);
    } else {
      lines.push(`${indent}${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    }
  }
  return lines;
}

/** Render the full dry-run plan as text (this text is the step's evidence). */
export function renderPlan(
  jobs: KeeperJob[],
  opts: PlanOptions & { slateSource: string; slateGeneratedAt: number },
): string {
  const lines: string[] = [];
  lines.push("FairOdds keeper — DRY-RUN plan (nothing is sent in this mode)");
  lines.push(`slate source: ${opts.slateSource}`);
  lines.push(
    `slate generated_at: ${opts.slateGeneratedAt} (${new Date(opts.slateGeneratedAt * 1000).toISOString()})`,
  );
  lines.push(`jobs: ${jobs.length}`);
  lines.push(`keeper signer (SIMULATED for dry-run): ${opts.keeper.toBase58()}`);
  lines.push(`commit issued_at (hash input): ${opts.issuedAt}`);
  lines.push(`LP deposit per market: ${opts.depositUsdc} mUSDC (devnet mock USDC)`);
  lines.push("");
  lines.push("Slate summary:");
  for (const j of jobs) {
    lines.push(
      `  ${j.asset}  strike $${j.strike}  model p=${(j.probBps / 100).toFixed(2)}% ` +
        `(${j.probBps} bps)  endTs ${j.endTs} (${new Date(j.endTs * 1000).toISOString()})  "${j.marketQuestion}"`,
    );
  }

  jobs.forEach((job, idx) => {
    lines.push("");
    lines.push("=".repeat(100));
    lines.push(
      `JOB ${idx + 1}/${jobs.length}: "${job.marketQuestion}" — strike $${job.strike} ` +
        `(raw ${job.strikeRaw}), probBps ${job.probBps}, initialPriceBps ${job.initialPriceBps}, ` +
        `endTs ${job.endTs}`,
    );
    lines.push("=".repeat(100));
    const steps = buildJobPlan(job, opts);
    steps.forEach((step, i) => {
      lines.push("");
      lines.push(`  Step ${i + 1}/5 — ${PHASE_TITLES[step.phase]}`);
      lines.push(...renderDetail(step.detail, "    "));
    });
  });

  lines.push("");
  lines.push(
    "Ordering guarantee: for every job, commit precedes create (the prediction is fixed " +
      "on-chain before trading opens), and attest follows resolve. Registry sends are " +
      "PENDING-DEPLOY; pm-AMM sends require live mode. This dry-run sent nothing.",
  );
  return lines.join("\n") + "\n";
}
