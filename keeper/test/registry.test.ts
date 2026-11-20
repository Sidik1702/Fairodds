import assert from "node:assert/strict";
import { test } from "node:test";
import { BorshInstructionCoder } from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ForecastRegistryClient,
  PendingDeployError,
  REGISTRY_PROGRAM_ID,
  loadRegistryIdl,
  predictionPda,
} from "../src/registry.js";

const MARKET = new PublicKey("9mxS9rrZekcwvFPVo1nVqqNxNiE9PExhuSvyqzh3Vxni");
const KEEPER = new PublicKey("6c1eJRKMymbts1wPK5yxDPBg9ZXcdXRVVRmFGVhNTHFH");
const HASH = Buffer.alloc(32, 7);
const idl = loadRegistryIdl();
const coder = new BorshInstructionCoder(idl);
const client = new ForecastRegistryClient(idl);

function idlIx(name: string): any {
  return idl.instructions.find((i: any) => i.name === name);
}

test("predictionPda derives the [b\"prediction\", market] PDA under the registry program", () => {
  const [pda, bump] = predictionPda(MARKET);
  const [expected, expectedBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("prediction"), MARKET.toBuffer()],
    REGISTRY_PROGRAM_ID,
  );
  assert.equal(pda.toBase58(), expected.toBase58());
  assert.equal(bump, expectedBump);
  assert.notEqual(predictionPda(KEEPER)[0].toBase58(), pda.toBase58()); // market-specific
});

test("buildCommitInstruction: exact program, discriminator, accounts", () => {
  const ix = client.buildCommitInstruction({
    market: MARKET,
    predictionHash: HASH,
    modelProbBps: 7545,
    modelVersion: "kernel-lr-v1",
    strikeRaw: 6_700_000_000n,
    keeper: KEEPER,
  });
  assert.equal(ix.programId.toBase58(), REGISTRY_PROGRAM_ID.toBase58());
  assert.deepEqual(
    [...ix.data.subarray(0, 8)],
    idlIx("commit_prediction").discriminator,
  );
  const [pda] = predictionPda(MARKET);
  assert.equal(ix.keys.length, 3);
  assert.equal(ix.keys[0].pubkey.toBase58(), pda.toBase58());
  assert.deepEqual([ix.keys[0].isSigner, ix.keys[0].isWritable], [false, true]);
  assert.equal(ix.keys[1].pubkey.toBase58(), KEEPER.toBase58());
  assert.deepEqual([ix.keys[1].isSigner, ix.keys[1].isWritable], [true, true]);
  assert.equal(ix.keys[2].pubkey.toBase58(), SystemProgram.programId.toBase58());
});

test("buildCommitInstruction data round-trips through the IDL coder", () => {
  const ix = client.buildCommitInstruction({
    market: MARKET,
    predictionHash: HASH,
    modelProbBps: 7545,
    modelVersion: "kernel-lr-v1",
    strikeRaw: 6_700_000_000n,
    keeper: KEEPER,
  });
  const decoded = coder.decode(ix.data);
  assert.equal(decoded?.name, "commit_prediction");
  const d = (decoded as any).data;
  assert.equal(d.market.toBase58(), MARKET.toBase58());
  assert.deepEqual(Array.from(d.prediction_hash as Iterable<number>), Array.from(HASH));
  assert.equal(d.model_prob_bps, 7545);
  assert.equal(d.model_version, "kernel-lr-v1");
  assert.equal(d.strike.toString(), "6700000000");
});

test("buildAttestInstruction: exact program, discriminator, accounts, round-trip", () => {
  const pyth = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
  const ix = client.buildAttestInstruction({
    market: MARKET,
    outcomeYes: true,
    pythPriceAccount: pyth,
    observedPriceRaw: 6_852_000_000n,
    observedSlot: 524_418_285n,
    keeper: KEEPER,
  });
  assert.equal(ix.programId.toBase58(), REGISTRY_PROGRAM_ID.toBase58());
  assert.deepEqual([...ix.data.subarray(0, 8)], idlIx("attest_resolution").discriminator);
  const [pda] = predictionPda(MARKET);
  assert.equal(ix.keys.length, 2);
  assert.equal(ix.keys[0].pubkey.toBase58(), pda.toBase58());
  assert.deepEqual([ix.keys[0].isSigner, ix.keys[0].isWritable], [false, true]);
  assert.equal(ix.keys[1].pubkey.toBase58(), KEEPER.toBase58());
  assert.deepEqual([ix.keys[1].isSigner, ix.keys[1].isWritable], [true, false]);

  const decoded = coder.decode(ix.data);
  assert.equal(decoded?.name, "attest_resolution");
  const d = (decoded as any).data;
  assert.equal(d.outcome_yes, true);
  assert.equal(d.pyth_price_account.toBase58(), pyth.toBase58());
  assert.equal(d.observed_price.toString(), "6852000000");
  assert.equal(d.observed_slot.toString(), "524418285");
});

test("registry sends are gated PENDING-DEPLOY without a live transport (dry-run safety)", async () => {
  await assert.rejects(
    client.commitPrediction({
      market: MARKET,
      predictionHash: HASH,
      modelProbBps: 7545,
      modelVersion: "kernel-lr-v1",
      strikeRaw: 6_700_000_000n,
      keeper: KEEPER,
    }),
    (e: any) => e instanceof PendingDeployError && /PENDING-DEPLOY/.test(e.message),
  );
  await assert.rejects(
    client.attestResolution({
      market: MARKET,
      outcomeYes: true,
      pythPriceAccount: MARKET,
      observedPriceRaw: 1n,
      observedSlot: 1n,
      keeper: KEEPER,
    }),
    PendingDeployError,
  );
});
