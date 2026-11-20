/**
 * fetch-data.cjs — LIVE devnet data fetch for the FairOdds demo app.
 *
 * Reads, over HTTPS RPC only (no websockets, no sends, no keys):
 *   1. Every PredictionRecord account of the ForecastRegistry program
 *      (getProgramAccounts + BorshAccountsCoder driven by the Step-1 IDL,
 *      src/idl/forecast_registry.json). Anchor allocates 225 bytes for the
 *      record while a short model_version serializes to fewer (205 for the
 *      Step-3 record); the borsh coder reads field-by-field and tolerates
 *      the trailing zero padding.
 *   2. The known pm-AMM devnet markets via PmAmmClient.readOnly().fetchMarket.
 *
 * Writes public/data.json in exactly the shape src/lib/chain.ts produces
 * in-browser, so the page renders identically from the snapshot or the
 * live refresh. Run: npm run fetch-data
 */
const fs = require("node:fs");
const path = require("node:path");
const { Connection, PublicKey } = require("@solana/web3.js");
const { BorshAccountsCoder } = require("@anchor-lang/core");
const { PmAmmClient, decodeName } = require("@pm-amm/sdk");
const idl = require("../src/idl/forecast_registry.json");

const RPC_URL = process.env.FAIRODDS_RPC ?? "https://api.devnet.solana.com";
const REGISTRY_PROGRAM_ID = new PublicKey(idl.address);
const PMAMM_PROGRAM_ID = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const DEVNET_MUSDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");

/** Known FairOdds devnet markets (state is read live; labels are UI context). */
const KNOWN_MARKETS = [
  {
    address: "3KhWpiKLmWt4DJn4EbBJfRFK5M68Dpz5yto8HKd7zvAu",
    label: "Step-3 live keeper run — SOL > $68.50 in 360 s, seeded at the model's 62%",
  },
  {
    address: "9mxS9rrZekcwvFPVo1nVqqNxNiE9PExhuSvyqzh3Vxni",
    label: "Day-2 lifecycle — first end-to-end pm-AMM run (create → swap → resolve → claim)",
  },
];

const bnStr = (v) => v.toString();
const rawToUsd = (rawDecimalStr) => Number(BigInt(rawDecimalStr)) / 1e8;

function normalizeRecord(pubkey, d) {
  return {
    address: pubkey.toBase58(),
    market: d.market.toBase58(),
    forecaster: d.forecaster.toBase58(),
    predictionHash: Buffer.from(d.prediction_hash).toString("hex"),
    modelProbBps: d.model_prob_bps,
    modelVersion: d.model_version,
    strikeRaw: bnStr(d.strike),
    strikeUsd: rawToUsd(bnStr(d.strike)),
    committedAt: Number(BigInt(bnStr(d.committed_at))),
    resolved: d.resolved,
    outcomeYes: d.outcome_yes,
    pythPriceAccount: d.pyth_price_account.toBase58(),
    observedPriceRaw: bnStr(d.observed_price),
    observedPriceUsd: rawToUsd(bnStr(d.observed_price)),
    observedSlot: bnStr(d.observed_slot),
    attestedAt: Number(BigInt(bnStr(d.attested_at))),
    brierE8: bnStr(d.brier_score_e8),
    brier: rawToUsd(bnStr(d.brier_score_e8)),
    bump: d.bump,
  };
}

function computeAggregate(records) {
  const resolved = records.filter((r) => r.resolved);
  const meanBrier =
    resolved.length === 0
      ? null
      : resolved.reduce((sum, r) => sum + r.brier, 0) / resolved.length;
  // A flat 50% forecast scores (0.5 - o)^2 = 0.25 on EVERY resolved market,
  // whatever the outcome — so the baseline mean over the same set is 0.25.
  const baselineBrier = 0.25;
  return {
    totalPredictions: records.length,
    resolvedPredictions: resolved.length,
    meanBrier,
    baselineBrier,
    improvementPct:
      meanBrier === null ? null : ((baselineBrier - meanBrier) / baselineBrier) * 100,
  };
}

function normalizeMarket(meta, m) {
  let name = "";
  try {
    name = decodeName(m.name);
  } catch {
    name = "";
  }
  return {
    address: meta.address,
    label: meta.label,
    name,
    authority: m.authority.toString(),
    marketId: m.marketId.toString(),
    startTs: Number(m.startTs.toString()),
    endTs: Number(m.endTs.toString()),
    resolved: m.resolved,
    winningSide: m.winningSide,
    winningLabel: !m.resolved ? null : m.winningSide === 1 ? "YES" : "NO",
    initialPriceBps: m.initialPriceBps,
    totalLpShares: m.totalLpShares.toString(),
  };
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  const coder = new BorshAccountsCoder(idl);
  const accounts = await connection.getProgramAccounts(REGISTRY_PROGRAM_ID);
  const records = accounts
    .map(({ pubkey, account }) =>
      normalizeRecord(pubkey, coder.decode("forecast_registry::PredictionRecord", account.data)),
    )
    .sort((a, b) => a.committedAt - b.committedAt);

  const client = PmAmmClient.readOnly(connection, PMAMM_PROGRAM_ID, DEVNET_MUSDC);
  const markets = [];
  for (const meta of KNOWN_MARKETS) {
    const m = await client.fetchMarket(new PublicKey(meta.address));
    if (!m) throw new Error(`market ${meta.address} not found on devnet`);
    markets.push(normalizeMarket(meta, m));
  }

  const data = {
    source: "live",
    fetchedAt: new Date().toISOString(),
    rpcUrl: RPC_URL,
    registryProgram: REGISTRY_PROGRAM_ID.toBase58(),
    pmammProgram: PMAMM_PROGRAM_ID.toBase58(),
    records,
    aggregate: computeAggregate(records),
    markets,
  };

  const out = path.join(__dirname, "..", "public", "data.json");
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
  console.log(`wrote ${out}`);
  console.log(
    `records: ${records.length} (resolved ${data.aggregate.resolvedPredictions}), ` +
      `mean Brier ${data.aggregate.meanBrier} vs baseline ${data.aggregate.baselineBrier}`,
  );
  for (const r of records) {
    console.log(
      `  ${r.address} market=${r.market} prob=${r.modelProbBps}bps strike=$${r.strikeUsd} ` +
        `resolved=${r.resolved} outcome=${r.resolved ? (r.outcomeYes ? "YES" : "NO") : "-"} brier=${r.brier}`,
    );
  }
  for (const m of markets) {
    console.log(
      `  market ${m.address} name="${m.name}" resolved=${m.resolved} winner=${m.winningLabel} seed=${m.initialPriceBps}bps`,
    );
  }
}

main().catch((e) => {
  console.error("fetch-data FAILED:", e);
  process.exit(1);
});
