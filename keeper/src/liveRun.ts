/**
 * FairOdds keeper — STEP 3 LIVE RUN (devnet only). `npm run live`.
 *
 * One market, end-to-end, in the ARCHITECTURE.md §2 order:
 *   1. choose a marketId and derive the pm-AMM market PDA from it
 *      (the SDK's send.createMarket randomizes the id internally; the
 *      bound ix builders + marketPda let the keeper choose it, so the
 *      prediction can be committed BEFORE the market exists)
 *   2. commit_prediction on ForecastRegistry (live transport)
 *   3. create the pm-AMM market with that exact id — the same instruction
 *      bundle send.createMarket builds (compute-budget + initializeMarket
 *      + depositLiquidity), seeded at the job's probBps, 10 mUSDC LP
 *   4. wait past endTs
 *   5. read SOL/USD spot from Coinbase Exchange at expiry — the DOCUMENTED
 *      FALLBACK for resolution evidence: the legacy Pyth devnet feed is
 *      stale (BUILD-LOG Step 3) and Hermes is unreachable from this
 *      sandbox. The registry record's pyth_price_account is therefore the
 *      none sentinel (Pubkey::default()) and this substitution is stated
 *      in the run state and the build log. The stale feed is never
 *      presented as a live read.
 *   6. resolveMarket on the pm-AMM with the derived outcome
 *   7. attest_resolution on ForecastRegistry
 *   8. fetch the PredictionRecord and verify every stored field, including
 *      the in-program Brier score, against the keeper's own mirror math.
 *
 * The job is a SYNTHETIC demonstration job (not a forecast-engine slate
 * entry): the strike is set from the live Coinbase spot and probBps is the
 * 6200 demo seed (the Day-2 model-style seed), because the engine's slate
 * is 24 h markets and this run needs a 360 s market. That is stated in the
 * state file, not hidden.
 *
 * Safety: state is checkpointed to examples/step3-live-state.json after
 * every step; if that file already exists the runner REFUSES to start (a
 * previous run's state needs manual review, never a silent second run).
 * Every send follows the sendAndConfirmHttp discipline (src/pmamm.ts):
 * confirm via HTTPS getSignatureStatuses polling, never blind-retry.
 */
import { CU } from "@pm-amm/sdk";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_MODEL_VERSION,
  deriveOutcomeYes,
  expectedBrierE8,
  predictionHash,
  usdToRaw,
} from "./jobs.js";
import {
  DEVNET_MUSDC,
  loadPmAmmClient,
  resolveMarket,
  sendAndConfirmHttp,
} from "./pmamm.js";
import {
  ForecastRegistryClient,
  findProjectRoot,
  loadRegistryIdl,
  predictionPda,
} from "./registry.js";

/** The registry's none sentinel for pyth_price_account (Rust Pubkey::default()). */
const NONE_SENTINEL = new PublicKey("11111111111111111111111111111111");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const PROB_BPS = 6200; // demo seed (Day-2 model-style 62%)
const DURATION_SECS = 360; // Day-2 lesson: exactly 300 s fails on-chain
const DEPOSIT_MUSDC = 10;
const COINBASE_TICKER = "https://api.exchange.coinbase.com/products/SOL-USD/ticker";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const txLink = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
const addrLink = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

function ataFor(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  )[0];
}

async function coinbaseSolUsd(): Promise<{ price: number; raw: string; fetchedAt: number }> {
  const res = await fetch(COINBASE_TICKER, {
    headers: { "User-Agent": "fairodds-keeper/step3-live-run" },
  });
  if (!res.ok) throw new Error(`Coinbase ticker HTTP ${res.status}`);
  const j: any = await res.json();
  const price = Number(j.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`bad Coinbase price: ${j.price}`);
  return { price, raw: String(j.price), fetchedAt: Math.floor(Date.now() / 1000) };
}

interface DecodedRecord {
  market: PublicKey;
  forecaster: PublicKey;
  predictionHash: Buffer;
  modelProbBps: number;
  modelVersion: string;
  strike: bigint;
  committedAt: bigint;
  resolved: boolean;
  outcomeYes: boolean;
  pythPriceAccount: PublicKey;
  observedPrice: bigint;
  observedSlot: bigint;
  attestedAt: bigint;
  brierScoreE8: bigint;
  bump: number;
}

/** Manual Borsh decode of PredictionRecord (layout: programs/forecast-registry/src/lib.rs). */
function decodeRecord(data: Buffer): DecodedRecord {
  let o = 8; // anchor discriminator
  const pk = () => {
    const k = new PublicKey(data.subarray(o, o + 32));
    o += 32;
    return k;
  };
  const market = pk();
  const forecaster = pk();
  const hash = Buffer.from(data.subarray(o, o + 32));
  o += 32;
  const modelProbBps = data.readUInt16LE(o);
  o += 2;
  const vlen = data.readUInt32LE(o);
  o += 4;
  const modelVersion = data.subarray(o, o + vlen).toString("utf8");
  o += vlen;
  const strike = data.readBigInt64LE(o);
  o += 8;
  const committedAt = data.readBigInt64LE(o);
  o += 8;
  const resolved = data[o] !== 0;
  o += 1;
  const outcomeYes = data[o] !== 0;
  o += 1;
  const pythPriceAccount = pk();
  const observedPrice = data.readBigInt64LE(o);
  o += 8;
  const observedSlot = data.readBigUInt64LE(o);
  o += 8;
  const attestedAt = data.readBigInt64LE(o);
  o += 8;
  const brierScoreE8 = data.readBigUInt64LE(o);
  o += 8;
  const bump = data[o];
  o += 1;
  // Anchor allocates 8 + INIT_SPACE, where the String field reserves its full
  // 32-byte max capacity; a shorter model_version therefore leaves zero
  // padding after the last field (this run: 205 of 225 bytes used, 20 zero).
  // Accept trailing bytes only if every one is zero unused capacity.
  const trailing = data.subarray(o);
  if (trailing.length > 0 && !trailing.every((b) => b === 0)) {
    throw new Error(`record decode consumed ${o} of ${data.length} bytes with non-zero trailing data`);
  }
  return {
    market,
    forecaster,
    predictionHash: hash,
    modelProbBps,
    modelVersion,
    strike,
    committedAt,
    resolved,
    outcomeYes,
    pythPriceAccount,
    observedPrice,
    observedSlot,
    attestedAt,
    brierScoreE8,
    bump,
  };
}

async function main(): Promise<void> {
  const root = findProjectRoot();
  const statePath = path.join(root, "keeper", "examples", "step3-live-state.json");
  if (fs.existsSync(statePath)) {
    throw new Error(
      `REFUSED: ${statePath} already exists — a previous live run's state needs manual review before any new run.`,
    );
  }
  const state: any = { step: "step3-live-run", startedAt: new Date().toISOString() };
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  const secret = Uint8Array.from(
    JSON.parse(fs.readFileSync(path.join(root, "devnet-tester.keypair.json"), "utf8")),
  );
  const keypair = Keypair.fromSecretKey(secret);
  const keeper = keypair.publicKey;
  const { connection, client } = loadPmAmmClient(keypair);
  const registry = new ForecastRegistryClient(loadRegistryIdl(), {
    live: { connection, signer: keypair },
  });

  const solBal = async () => connection.getBalance(keeper);
  const musdcBal = async (): Promise<number> => {
    const info = await connection.getAccountInfo(ataFor(keeper, DEVNET_MUSDC));
    if (!info) return 0;
    return Number(info.data.readBigUInt64LE(64)) / 1e6;
  };

  state.keeper = keeper.toBase58();
  state.solBeforeLamports = await solBal();
  state.musdcBefore = await musdcBal();
  console.log(`keeper ${keeper.toBase58()}: ${state.solBeforeLamports} lamports, ${state.musdcBefore} mUSDC`);
  if (state.musdcBefore < DEPOSIT_MUSDC) throw new Error("insufficient mUSDC for the LP deposit");

  // --- Job: synthetic, strike from live Coinbase spot ---
  const spot0 = await coinbaseSolUsd();
  let strike = Math.floor(spot0.price * 2) / 2;
  if (spot0.price - strike < 0.25) strike -= 0.5;
  const strikeRaw = usdToRaw(strike);
  const name = `FairOdds live: SOL above $${strike.toFixed(2)} in 6 min? (seed 62%)`;
  if (Buffer.byteLength(name, "utf8") > 64) throw new Error(`market name too long: ${name}`);
  state.job = {
    kind: "synthetic demonstration job (not a forecast-engine slate entry)",
    asset: "SOL",
    spotAtStart: spot0.price,
    strikeUsd: strike,
    strikeRaw: strikeRaw.toString(),
    probBps: PROB_BPS,
    probNote: "6200 bps demo seed (the Day-2 model-style seed); the engine slate is 24h markets, this run needs 360 s",
    durationSecs: DURATION_SECS,
    depositMusdc: DEPOSIT_MUSDC,
    marketName: name,
    modelVersion: DEFAULT_MODEL_VERSION,
  };
  console.log(`job: spot $${spot0.price} -> strike $${strike.toFixed(2)}, prob ${PROB_BPS} bps, "${name}"`);

  // --- 1. Choose marketId, derive the market PDA ---
  const marketId = randomBytes(6).readUIntBE(0, 6);
  const market = client.marketPda(marketId);
  if (await connection.getAccountInfo(market)) throw new Error("chosen market PDA already exists");
  const [prediction] = predictionPda(market);
  if (await connection.getAccountInfo(prediction)) throw new Error("prediction PDA already exists");
  state.marketId = marketId;
  state.market = market.toBase58();
  state.predictionRecord = prediction.toBase58();
  console.log(`marketId ${marketId} -> market ${market.toBase58()}`);
  console.log(`  ${addrLink(market.toBase58())}`);

  // --- 2. Commit the prediction BEFORE the market exists ---
  const issuedAt = Math.floor(Date.now() / 1000);
  const hash = predictionHash(market, PROB_BPS, DEFAULT_MODEL_VERSION, issuedAt);
  state.issuedAt = issuedAt;
  state.predictionHashHex = hash.toString("hex");
  const commitSig = await registry.commitPrediction({
    market,
    predictionHash: hash,
    modelProbBps: PROB_BPS,
    modelVersion: DEFAULT_MODEL_VERSION,
    strikeRaw,
    keeper,
  });
  state.commitSignature = commitSig;
  save();
  console.log(`COMMIT: ${commitSig}\n  ${txLink(commitSig)}`);
  const recInfo0 = await connection.getAccountInfo(prediction);
  if (!recInfo0) throw new Error("prediction record missing after commit");
  console.log(`record created: ${recInfo0.data.length} bytes, owner ${recInfo0.owner.toBase58()}`);

  // --- 3. Create the pm-AMM market with the chosen id (seed = probBps) ---
  const endTs = Math.floor(Date.now() / 1000) + DURATION_SECS;
  state.endTs = endTs;
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU.HEAVY }),
    await client.ix.initializeMarket({
      authority: keeper,
      marketId,
      endTs,
      name,
      initialPriceBps: PROB_BPS,
      collateralMint: DEVNET_MUSDC,
    }),
  ];
  const musdcAta = ataFor(keeper, DEVNET_MUSDC);
  if (!(await connection.getAccountInfo(musdcAta)))
    throw new Error("keeper mUSDC ATA missing (send.createMarket would add a create-ATA ix here)");
  ixs.push(
    await client.ix.depositLiquidity({
      signer: keeper,
      market,
      amount: DEPOSIT_MUSDC * 1_000_000,
      collateralMint: DEVNET_MUSDC,
    }),
  );
  const createSig = await sendAndConfirmHttp(connection, () => client.sendIxs(ixs));
  state.createSignature = createSig;
  save();
  console.log(`CREATE: ${createSig}\n  ${txLink(createSig)}`);
  const mkt = await client.fetchMarket(market);
  if (!mkt) throw new Error("market not fetchable after create");
  console.log(`market live: endTs=${mkt.endTs.toString()} resolved=${mkt.resolved}`);
  if (Number(mkt.endTs) !== endTs) throw new Error(`market endTs ${mkt.endTs} != chosen ${endTs}`);
  state.musdcAfterCreate = await musdcBal();
  console.log(`mUSDC after create: ${state.musdcAfterCreate} (deposit ${DEPOSIT_MUSDC} locked as LP)`);

  // --- 4. Wait past endTs ---
  for (;;) {
    const now = Math.floor(Date.now() / 1000);
    const m = await client.fetchMarket(market);
    console.log(`wait: now=${now} endTs=${endTs} resolved=${m?.resolved}`);
    if (now >= endTs + 5) break;
    await sleep(Math.min((endTs + 5 - now) * 1000, 20000));
  }

  // --- 5. Resolution evidence: Coinbase spot at expiry (documented fallback) ---
  const spotX = await coinbaseSolUsd();
  const observedRaw = usdToRaw(spotX.price);
  const observedSlot = await connection.getSlot("confirmed");
  const outcomeYes = deriveOutcomeYes(observedRaw, strikeRaw);
  state.expiryRead = {
    source: "Coinbase Exchange public ticker (forecast engine's data source)",
    fallbackNote:
      "Legacy Pyth devnet SOL/USD feed is stale and Hermes is unreachable from this sandbox (BUILD-LOG Step 3); pyth_price_account is attested as the none sentinel (Pubkey::default()).",
    priceUsd: spotX.price,
    priceRaw: spotX.raw,
    fetchedAt: spotX.fetchedAt,
    observedRaw: observedRaw.toString(),
    observedSlot,
    outcomeYes,
  };
  save();
  console.log(
    `expiry read: SOL $${spotX.price} (raw ${observedRaw}) vs strike $${strike.toFixed(2)} -> outcome ${outcomeYes ? "YES" : "NO"}`,
  );

  // --- 6. Resolve on the pm-AMM ---
  const resolveSig = await resolveMarket(connection, client, market, outcomeYes, { live: true });
  state.resolveSignature = resolveSig;
  save();
  console.log(`RESOLVE: ${resolveSig}\n  ${txLink(resolveSig)}`);
  const mktAfter = await client.fetchMarket(market);
  console.log(`post-resolve: resolved=${mktAfter?.resolved} winningSide=${mktAfter?.winningSide} (1=YES, 2=NO per Day-2 convention)`);
  if (!mktAfter?.resolved) throw new Error("market not resolved after resolveMarket");

  // --- 7. Attest on ForecastRegistry ---
  const attestSig = await registry.attestResolution({
    market,
    outcomeYes,
    pythPriceAccount: NONE_SENTINEL,
    observedPriceRaw: observedRaw,
    observedSlot: BigInt(observedSlot),
    keeper,
  });
  state.attestSignature = attestSig;
  save();
  console.log(`ATTEST: ${attestSig}\n  ${txLink(attestSig)}`);

  // --- 8. Fetch + verify the PredictionRecord field-by-field ---
  const recInfo = await connection.getAccountInfo(prediction);
  if (!recInfo) throw new Error("prediction record missing after attest");
  const rec = decodeRecord(Buffer.from(recInfo.data));
  const discExpected = createHash("sha256").update("account:PredictionRecord").digest().subarray(0, 8);
  const checks: Record<string, boolean> = {
    discriminatorIsPredictionRecord: Buffer.from(recInfo.data.subarray(0, 8)).equals(discExpected),
    market: rec.market.equals(market),
    forecaster: rec.forecaster.equals(keeper),
    predictionHash: rec.predictionHash.equals(hash),
    modelProbBps: rec.modelProbBps === PROB_BPS,
    modelVersion: rec.modelVersion === DEFAULT_MODEL_VERSION,
    strike: rec.strike === strikeRaw,
    resolved: rec.resolved === true,
    outcomeYes: rec.outcomeYes === outcomeYes,
    pythSentinelNone: rec.pythPriceAccount.equals(NONE_SENTINEL),
    observedPrice: rec.observedPrice === observedRaw,
    observedSlot: rec.observedSlot === BigInt(observedSlot),
    attestedAfterCommit: rec.attestedAt > rec.committedAt,
    brierMatchesProgramMath: rec.brierScoreE8 === expectedBrierE8(PROB_BPS, outcomeYes),
  };
  state.recordVerification = {
    record: {
      market: rec.market.toBase58(),
      forecaster: rec.forecaster.toBase58(),
      predictionHashHex: rec.predictionHash.toString("hex"),
      modelProbBps: rec.modelProbBps,
      modelVersion: rec.modelVersion,
      strikeRaw: rec.strike.toString(),
      committedAt: rec.committedAt.toString(),
      resolved: rec.resolved,
      outcomeYes: rec.outcomeYes,
      pythPriceAccount: rec.pythPriceAccount.toBase58(),
      observedPriceRaw: rec.observedPrice.toString(),
      observedSlot: rec.observedSlot.toString(),
      attestedAt: rec.attestedAt.toString(),
      brierScoreE8: rec.brierScoreE8.toString(),
      bump: rec.bump,
    },
    checks,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  console.log("record verification:", JSON.stringify(checks, null, 2));
  if (failed.length) throw new Error(`record verification FAILED: ${failed.map(([k]) => k).join(", ")}`);

  state.solAfterLamports = await solBal();
  state.musdcAfter = await musdcBal();
  state.completedAt = new Date().toISOString();
  save();
  console.log(
    `balances: SOL ${state.solBeforeLamports} -> ${state.solAfterLamports} lamports; mUSDC ${state.musdcBefore} -> ${state.musdcAfter}`,
  );
  console.log("LIVE RUN COMPLETE — state written to", statePath);
}

main().catch((e) => {
  console.error("LIVE RUN FAILED:", e?.message ?? e);
  if (e?.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
