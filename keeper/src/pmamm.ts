/**
 * pm-AMM access for the keeper — seed step + resolution driving.
 *
 * Patterns are ported from the proven Day-2 lifecycle scripts
 * (scripts/pmamm-lifecycle/lifecycle.cjs and settle2.cjs):
 *   - client construction: PmAmmClient.fromProvider(provider, PMAMM, mUSDC)
 *   - createMarket({ name, durationSecs, initialPriceBps, depositUsdc })
 *     with initialPriceBps = the model's probability (custom seed)
 *   - resolveMarket(market, "yes" | "no") by the market authority (creator)
 *   - claimWinnings(market)
 *
 * CONFIRMATION RULE (hard-won, BUILD-LOG Day-2 completion): this sandbox
 * breaks websocket confirmations — sends report "not confirmed in 30s" yet
 * finalize on-chain. Every send here goes through sendAndConfirmHttp():
 * catch the timeout, extract the signature from the error, and poll
 * getSignatureStatuses over HTTPS. NEVER blind-retry a timed-out send.
 *
 * Simulate-first caveat (from lifecycle.cjs): the SDK's send.* path does
 * not expose the built transaction for a separate simulateTransaction, so
 * live sends are gated on verified on-chain preconditions instead (the
 * caller checks balances/market state first), exactly as the lifecycle did.
 *
 * All live functions require { live: true }; without it they throw
 * DryRunOnlyError. The CLI's default mode is dry-run and sends nothing.
 */
import { AnchorProvider, Wallet } from "@anchor-lang/core";
import { PmAmmClient } from "@pm-amm/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { KeeperJob } from "./types.js";

export const PMAMM_PROGRAM_ID = new PublicKey(
  "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y",
);
/** Mock USDC on devnet (the pm-AMM hackathon deployment's collateral). */
export const DEVNET_MUSDC = new PublicKey(
  "3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ",
);
export const DEVNET_RPC = "https://api.devnet.solana.com";

export class DryRunOnlyError extends Error {
  constructor(what: string) {
    super(
      `${what} requires live mode ({ live: true } / --live). ` +
        `The keeper skeleton's default mode is dry-run: it prints the plan and sends nothing.`,
    );
    this.name = "DryRunOnlyError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send via the SDK and confirm by polling getSignatureStatuses over HTTPS.
 * Ported from scripts/pmamm-lifecycle/settle2.cjs (sendAndConfirmHttp),
 * which carried the Day-2 resolve + claim steps cleanly.
 */
export async function sendAndConfirmHttp(
  connection: Connection,
  send: () => Promise<string>,
): Promise<string> {
  let sig: string | null = null;
  try {
    sig = await send();
  } catch (e: any) {
    // The ws-confirmation timeout error still carries the signature; the
    // transaction may well have finalized. Extract and verify — never resend.
    const m = /signature ([A-Za-z0-9]{32,})/.exec(e?.message ?? "");
    if (!m) throw e;
    sig = m[1];
  }
  for (let i = 0; i < 40; i++) {
    const st = (
      await connection.getSignatureStatuses([sig], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (st && (st.confirmationStatus === "finalized" || st.confirmationStatus === "confirmed")) {
      if (st.err) throw new Error(`tx failed on-chain: ${JSON.stringify(st.err)}`);
      return sig;
    }
    await sleep(3000);
  }
  throw new Error(`tx not confirmed via HTTP polling: ${sig}`);
}

/** Build the pm-AMM client exactly as the lifecycle scripts do. */
export function loadPmAmmClient(
  keypair: Keypair,
  rpcUrl: string = DEVNET_RPC,
): { connection: Connection; client: PmAmmClient } {
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(keypair), {
    commitment: "confirmed",
  });
  const client = PmAmmClient.fromProvider(provider, PMAMM_PROGRAM_ID, DEVNET_MUSDC);
  return { connection, client };
}

/** The exact createMarket parameters for a job (pure — unit-tested). */
export interface CreateMarketParams {
  name: string;
  durationSecs: number;
  initialPriceBps: number;
  depositUsdc: number;
}

export function planCreateMarket(job: KeeperJob, depositUsdc: number): CreateMarketParams {
  if (!(depositUsdc > 0)) throw new Error(`depositUsdc must be positive, got ${depositUsdc}`);
  return {
    name: job.marketQuestion,
    durationSecs: job.durationSecs,
    initialPriceBps: job.initialPriceBps, // the model's fair price — the FairOdds thesis
    depositUsdc,
  };
}

export interface CreatedMarket {
  market: PublicKey;
  /** pm-AMM market id (null when the market was recovered after a ws timeout). */
  marketId: number | null;
  signature: string;
}

/**
 * Create + seed a market for a job on devnet (LIVE only).
 * If the create lands but the websocket confirmation times out, the market
 * PDA is recovered from the confirmed transaction's account list (the
 * Day-2 recovery path) instead of re-sending.
 */
export async function createSeededMarket(
  connection: Connection,
  client: PmAmmClient,
  job: KeeperJob,
  depositUsdc: number,
  opts: { live: boolean },
): Promise<CreatedMarket> {
  if (!opts.live) throw new DryRunOnlyError("createSeededMarket");
  const params = planCreateMarket(job, depositUsdc);
  // SDK typing note: send.createMarket returns marketPda as a base58 string.
  let created: { marketPda: string; marketId: number; signature: string } | null = null;
  try {
    created = await client.send.createMarket({ ...params });
  } catch (e: any) {
    const m = /signature ([A-Za-z0-9]{32,})/.exec(e?.message ?? "");
    if (!m) throw e;
    const sig = await sendAndConfirmHttp(connection, () => Promise.resolve(m[1]));
    // Recover the market PDA from the landed transaction: it is the
    // pm-AMM-owned account in the tx that fetchMarket can decode.
    const tx = await connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) throw new Error(`create tx ${sig} confirmed but not fetchable yet`);
    const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
    for (const k of keys) {
      const info = await connection.getAccountInfo(k);
      if (info && info.owner.equals(PMAMM_PROGRAM_ID)) {
        try {
          await client.fetchMarket(k);
          return { market: k, marketId: null, signature: sig };
        } catch {
          /* not a market account — keep scanning */
        }
      }
    }
    throw new Error(`create tx ${sig} landed but no market account found in it`);
  }
  if (!created) throw new Error("createMarket returned no result");
  const signature = await sendAndConfirmHttp(connection, () =>
    Promise.resolve(created.signature),
  );
  return { market: new PublicKey(created.marketPda), marketId: created.marketId, signature };
}

/** Resolve a market on the pm-AMM as its authority (LIVE only). */
export async function resolveMarket(
  connection: Connection,
  client: PmAmmClient,
  market: PublicKey,
  outcomeYes: boolean,
  opts: { live: boolean },
): Promise<string> {
  if (!opts.live) throw new DryRunOnlyError("resolveMarket");
  return sendAndConfirmHttp(connection, () =>
    client.send.resolveMarket(market, outcomeYes ? "yes" : "no"),
  );
}

/** Claim winnings for a resolved market (LIVE only). */
export async function claimWinnings(
  connection: Connection,
  client: PmAmmClient,
  market: PublicKey,
  opts: { live: boolean },
): Promise<string> {
  if (!opts.live) throw new DryRunOnlyError("claimWinnings");
  return sendAndConfirmHttp(connection, () => client.send.claimWinnings(market));
}
