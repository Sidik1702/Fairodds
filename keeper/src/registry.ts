/**
 * ForecastRegistry client — LIVE since Step 3 (2026-11-21).
 *
 * The ForecastRegistry program (Step 1) is implemented, verified locally
 * (14 unit + 3 LiteSVM tests green) and DEPLOYED to devnet in Step 3:
 *   program id  G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU
 *   deploy tx   EysiVYthJRkLA6WvHEmSxqun6k7m1bF13BPY5pzcKPuGUc11uy2RxEgbSExQhdVTprsdvM8oGW4RYfmzW4Ex7vc
 *
 * This module does two things:
 *   1. EXACT instruction construction — commit_prediction / attest_resolution
 *      instructions are built with anchor's BorshInstructionCoder driven by
 *      the program's own IDL (target/idl/forecast_registry.json, generated
 *      in Step 1), with account metas taken from the IDL's account flags and
 *      the PredictionRecord PDA derived from the program's seeds
 *      [b"prediction", market]. The dry-run prints these instructions and
 *      the tests round-trip them through the coder.
 *   2. SENDS, gated on an explicit live transport — a client constructed
 *      WITHOUT { live: { connection, signer } } (the default, used by the
 *      dry-run plan and the tests) still throws PendingDeployError from its
 *      send methods, so nothing can be sent by accident. With a transport,
 *      sends go build -> sign -> sendRawTransaction (HTTPS, returns the
 *      signature immediately) -> sendAndConfirmHttp polling
 *      (src/pmamm.ts) — the sandbox-proven pattern; websockets are never
 *      used for confirmation. Callers program against the RegistryClient
 *      interface below either way.
 */
import { BN, BorshInstructionCoder } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { sendAndConfirmHttp } from "./pmamm.js";

export const REGISTRY_PROGRAM_ID = new PublicKey(
  "G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU",
);
export const PREDICTION_SEED = "prediction";

/**
 * Thrown by registry send paths on a client constructed WITHOUT a live
 * transport. (Name kept from Step 2, when the gate existed because the
 * program was not deployed yet; since the Step-3 deploy the gate is the
 * dry-run safety: no transport, no sends.)
 */
export class PendingDeployError extends Error {
  constructor(what: string) {
    super(
      `PENDING-DEPLOY: ${what} cannot be sent — this ForecastRegistryClient ` +
        `was constructed without a live transport ({ live: { connection, signer } }), ` +
        `so its sends are refused. ForecastRegistry ${REGISTRY_PROGRAM_ID.toBase58()} ` +
        `IS deployed to devnet (Step 3); instruction construction is always available.`,
    );
    this.name = "PendingDeployError";
  }
}

/** Live send transport for the registry client (devnet). */
export interface LiveTransport {
  connection: Connection;
  signer: Keypair;
}

/** Walk up from `start` until the fairodds project root (Anchor.toml). */
export function findProjectRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "Anchor.toml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Anchor.toml not found above ${start}`);
    dir = parent;
  }
}

/** Load the Step-1 IDL (FAIRODDS_IDL_PATH overrides the default location). */
export function loadRegistryIdl(): any {
  const idlPath =
    process.env.FAIRODDS_IDL_PATH ??
    path.join(findProjectRoot(), "target", "idl", "forecast_registry.json");
  return JSON.parse(fs.readFileSync(idlPath, "utf8"));
}

/** The one PredictionRecord PDA per pm-AMM market: seeds [b"prediction", market]. */
export function predictionPda(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PREDICTION_SEED, "utf8"), market.toBuffer()],
    REGISTRY_PROGRAM_ID,
  );
}

export interface CommitParams {
  market: PublicKey;
  predictionHash: Buffer; // 32 bytes, see jobs.ts predictionHash()
  modelProbBps: number;
  modelVersion: string;
  strikeRaw: bigint;
  keeper: PublicKey;
}

export interface AttestParams {
  market: PublicKey;
  outcomeYes: boolean;
  pythPriceAccount: PublicKey;
  observedPriceRaw: bigint;
  observedSlot: bigint;
  keeper: PublicKey;
}

/** The interface the keeper's pipeline programs against. */
export interface RegistryClient {
  buildCommitInstruction(params: CommitParams): TransactionInstruction;
  buildAttestInstruction(params: AttestParams): TransactionInstruction;
  /** Send commit_prediction. Requires a live transport (see class docs). */
  commitPrediction(params: CommitParams): Promise<string>;
  /** Send attest_resolution. Requires a live transport (see class docs). */
  attestResolution(params: AttestParams): Promise<string>;
}

interface IdlAccount {
  name: string;
  writable?: boolean;
  signer?: boolean;
}

export class ForecastRegistryClient implements RegistryClient {
  private readonly coder: BorshInstructionCoder;
  private readonly idl: any;
  private readonly live?: LiveTransport;

  constructor(idl: any = loadRegistryIdl(), opts: { live?: LiveTransport } = {}) {
    if (idl.address !== REGISTRY_PROGRAM_ID.toBase58()) {
      throw new Error(
        `IDL address ${idl.address} does not match REGISTRY_PROGRAM_ID ${REGISTRY_PROGRAM_ID.toBase58()}`,
      );
    }
    this.idl = idl;
    this.coder = new BorshInstructionCoder(idl);
    this.live = opts.live;
  }

  /** Account metas for an instruction, with flags taken from the IDL. */
  private metas(ixName: string, byName: Record<string, PublicKey>): AccountMeta[] {
    const ix = this.idl.instructions.find((i: any) => i.name === ixName);
    if (!ix) throw new Error(`instruction ${ixName} not in registry IDL`);
    return (ix.accounts as IdlAccount[]).map((a) => {
      const pubkey = byName[a.name];
      if (!pubkey) throw new Error(`no pubkey supplied for account ${a.name}`);
      return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable };
    });
  }

  buildCommitInstruction(p: CommitParams): TransactionInstruction {
    const [prediction] = predictionPda(p.market);
    const data = this.coder.encode("commit_prediction", {
      market: p.market,
      prediction_hash: p.predictionHash,
      model_prob_bps: p.modelProbBps,
      model_version: p.modelVersion,
      strike: new BN(p.strikeRaw.toString()),
    });
    return new TransactionInstruction({
      programId: REGISTRY_PROGRAM_ID,
      keys: this.metas("commit_prediction", {
        prediction,
        keeper: p.keeper,
        system_program: new PublicKey("11111111111111111111111111111111"),
      }),
      data,
    });
  }

  buildAttestInstruction(p: AttestParams): TransactionInstruction {
    const [prediction] = predictionPda(p.market);
    const data = this.coder.encode("attest_resolution", {
      outcome_yes: p.outcomeYes,
      pyth_price_account: p.pythPriceAccount,
      observed_price: new BN(p.observedPriceRaw.toString()),
      observed_slot: new BN(p.observedSlot.toString()),
    });
    return new TransactionInstruction({
      programId: REGISTRY_PROGRAM_ID,
      keys: this.metas("attest_resolution", {
        prediction,
        keeper: p.keeper,
      }),
      data,
    });
  }

  /**
   * Sign and send one instruction with the live transport, confirming by
   * HTTPS polling (sendAndConfirmHttp, src/pmamm.ts). sendRawTransaction
   * returns the signature as soon as the tx is submitted — no websocket
   * confirmation is involved anywhere. A preflight failure throws before
   * submission; a submitted tx is only ever polled, never re-sent.
   */
  private async sendInstruction(
    ix: TransactionInstruction,
    what: string,
  ): Promise<string> {
    if (!this.live) throw new PendingDeployError(what);
    const { connection, signer } = this.live;
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash });
    tx.add(ix);
    tx.sign(signer);
    const raw = tx.serialize();
    return sendAndConfirmHttp(connection, () =>
      connection.sendRawTransaction(raw, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      }),
    );
  }

  async commitPrediction(p: CommitParams): Promise<string> {
    return this.sendInstruction(this.buildCommitInstruction(p), "commit_prediction");
  }

  async attestResolution(p: AttestParams): Promise<string> {
    return this.sendInstruction(this.buildAttestInstruction(p), "attest_resolution");
  }
}

/** Human/JSON-friendly description of a built instruction (dry-run output). */
export function describeInstruction(ix: TransactionInstruction): {
  programId: string;
  keys: { pubkey: string; signer: boolean; writable: boolean }[];
  dataLength: number;
  dataHex: string;
} {
  return {
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({
      pubkey: k.pubkey.toBase58(),
      signer: k.isSigner,
      writable: k.isWritable,
    })),
    dataLength: ix.data.length,
    dataHex: Buffer.from(ix.data).toString("hex"),
  };
}
