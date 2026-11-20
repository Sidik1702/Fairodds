/**
 * chain.ts — FairOdds on-chain reads (devnet, HTTPS RPC only, read-only).
 *
 * Two data routes produce the SAME FairOddsData shape:
 *   - fetchLiveData(): in-browser live reads — getProgramAccounts on the
 *     ForecastRegistry program, decoded with the Step-1 IDL via anchor's
 *     BorshAccountsCoder (the 225-byte account allocation vs 205-byte
 *     serialization padding is tolerated: borsh reads field-by-field),
 *     plus pm-AMM market state via PmAmmClient.readOnly().fetchMarket.
 *   - fetchSnapshot(): public/data.json, produced by the identical reads
 *     in scripts/fetch-data.cjs (`npm run fetch-data`).
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@anchor-lang/core";
import idlJson from "../idl/forecast_registry.json";

export const RPC_URL = "https://api.devnet.solana.com";
export const REGISTRY_PROGRAM_ID = idlJson.address as string;
export const PMAMM_PROGRAM_ID = "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y";
export const DEVNET_MUSDC = "3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ";
export const TEAM_NAME = "Pasukan Satset";

export interface PredictionRecordData {
  address: string;
  market: string;
  forecaster: string;
  predictionHash: string;
  modelProbBps: number;
  modelVersion: string;
  strikeRaw: string;
  strikeUsd: number;
  committedAt: number;
  resolved: boolean;
  outcomeYes: boolean;
  pythPriceAccount: string;
  observedPriceRaw: string;
  observedPriceUsd: number;
  observedSlot: string;
  attestedAt: number;
  brierE8: string;
  brier: number;
  bump: number;
}

export interface AggregateData {
  totalPredictions: number;
  resolvedPredictions: number;
  meanBrier: number | null;
  baselineBrier: number;
  improvementPct: number | null;
}

export interface MarketData {
  address: string;
  label: string;
  name: string;
  authority: string;
  marketId: string;
  startTs: number;
  endTs: number;
  resolved: boolean;
  winningSide: number;
  winningLabel: "YES" | "NO" | null;
  initialPriceBps: number;
  totalLpShares: string;
}

export interface FairOddsData {
  fetchedAt: string;
  rpcUrl: string;
  registryProgram: string;
  pmammProgram: string;
  records: PredictionRecordData[];
  aggregate: AggregateData;
  markets: MarketData[];
}

/** Known FairOdds devnet markets (state is read live; labels are UI context). */
export const KNOWN_MARKETS: { address: string; label: string }[] = [
  {
    address: "3KhWpiKLmWt4DJn4EbBJfRFK5M68Dpz5yto8HKd7zvAu",
    label: "Step-3 live keeper run — SOL > $68.50 in 360 s, seeded at the model's 62%",
  },
  {
    address: "9mxS9rrZekcwvFPVo1nVqqNxNiE9PExhuSvyqzh3Vxni",
    label: "Day-2 lifecycle — first end-to-end pm-AMM run (create → swap → resolve → claim)",
  },
];

export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

const rawToUsd = (rawDecimalStr: string): number => Number(BigInt(rawDecimalStr)) / 1e8;

function bytesToHex(bytes: ArrayLike<number>): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

function normalizeRecord(address: string, d: any): PredictionRecordData {
  const strikeRaw = d.strike.toString();
  const observedRaw = d.observed_price.toString();
  const brierE8 = d.brier_score_e8.toString();
  return {
    address,
    market: d.market.toBase58(),
    forecaster: d.forecaster.toBase58(),
    predictionHash: bytesToHex(d.prediction_hash),
    modelProbBps: d.model_prob_bps,
    modelVersion: d.model_version,
    strikeRaw,
    strikeUsd: rawToUsd(strikeRaw),
    committedAt: Number(BigInt(d.committed_at.toString())),
    resolved: d.resolved,
    outcomeYes: d.outcome_yes,
    pythPriceAccount: d.pyth_price_account.toBase58(),
    observedPriceRaw: observedRaw,
    observedPriceUsd: rawToUsd(observedRaw),
    observedSlot: d.observed_slot.toString(),
    attestedAt: Number(BigInt(d.attested_at.toString())),
    brierE8,
    brier: rawToUsd(brierE8),
    bump: d.bump,
  };
}

export function computeAggregate(records: PredictionRecordData[]): AggregateData {
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

function normalizeMarket(meta: { address: string; label: string }, m: any, decodeName: (n: number[]) => string): MarketData {
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

/** Live in-browser read of the full demo dataset from Solana devnet. */
export async function fetchLiveData(): Promise<FairOddsData> {
  const connection = new Connection(RPC_URL, "confirmed");
  const coder = new BorshAccountsCoder(idlJson as any);
  const accounts = await connection.getProgramAccounts(new PublicKey(REGISTRY_PROGRAM_ID));
  const records = accounts
    .map(({ pubkey, account }) =>
      normalizeRecord(
        pubkey.toBase58(),
        coder.decode("forecast_registry::PredictionRecord", account.data),
      ),
    )
    .sort((a, b) => a.committedAt - b.committedAt);

  const { PmAmmClient, decodeName } = await import("@pm-amm/sdk");
  const client = PmAmmClient.readOnly(
    connection,
    new PublicKey(PMAMM_PROGRAM_ID),
    new PublicKey(DEVNET_MUSDC),
  );
  const markets: MarketData[] = [];
  for (const meta of KNOWN_MARKETS) {
    const m = await client.fetchMarket(new PublicKey(meta.address));
    if (m) markets.push(normalizeMarket(meta, m, decodeName));
  }

  return {
    fetchedAt: new Date().toISOString(),
    rpcUrl: RPC_URL,
    registryProgram: REGISTRY_PROGRAM_ID,
    pmammProgram: PMAMM_PROGRAM_ID,
    records,
    aggregate: computeAggregate(records),
    markets,
  };
}

/** Snapshot produced by scripts/fetch-data.cjs (same reads, run in Node). */
export async function fetchSnapshot(): Promise<FairOddsData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`data.json: HTTP ${res.status}`);
  return (await res.json()) as FairOddsData;
}
