/**
 * FairOdds Step 3 — deploy ForecastRegistry to devnet over HTTPS only.
 *
 * Why this script exists: `solana program deploy` (Agave CLI 2.1.21) panics
 * in this sandbox when it builds its websocket TPU client
 * ("Should return a valid tpu client: PubsubError(...)") — the sandbox
 * breaks all websocket connections. Before panicking, the CLI did land one
 * transaction: createAccount + InitializeBuffer for buffer
 * BhscEt6Ry5XdRWsbXhEP4PNCDG9mvnjR3o3x3wTuL8Kc (tx 3w1grShr..., authority =
 * tester, 214,405 bytes = 37-byte header + 214,368-byte body, body zeroed).
 *
 * This script adopts that buffer and finishes the deploy with raw
 * upgradeable-loader instructions (formats taken from the canonical
 * solana-loader-v3-interface 5.0.0 source):
 *   Write (tag 1):            [buffer (w), authority (ro, signer)]
 *                             data = u32 tag + u32 offset + u64 len + bytes
 *   DeployWithMaxDataLen (2): preceded by system createAccount for the
 *                             program account (36 bytes, loader-owned);
 *                             programdata = PDA find_program_address(
 *                               [program_pubkey], loader_program)
 * Every send is sendRawTransaction over HTTPS (returns the signature
 * immediately — no websocket anywhere) and is confirmed by polling
 * getSignatureStatuses. A chunk is re-sent ONLY when its blockhash has
 * provably expired with a null status (such a tx can never land), which is
 * a proof of non-inclusion, not a blind retry. Any on-chain error stops
 * the script with the evidence printed.
 *
 * Devnet only. Keys: tester (payer/authority) + the program keypair.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
} = require("@solana/web3.js");

const RPC = "https://api.devnet.solana.com";
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const ROOT = path.join(__dirname, "..", "..");
const TESTER_PATH = path.join(ROOT, "devnet-tester.keypair.json");
const PROGRAM_KP_PATH = path.join(ROOT, "target", "deploy", "forecast_registry-keypair.json");
const SO_PATH = path.join(ROOT, "target", "deploy", "forecast_registry.so");
const BUFFER = new PublicKey("BhscEt6Ry5XdRWsbXhEP4PNCDG9mvnjR3o3x3wTuL8Kc");
const CREATE_BUFFER_SIG =
  "3w1grShrHnB6sdnDDTuF8Mh8sijmzQoJPcTvKTP1bSSVkJEwSHKN3xUDfLfUeW5FJoUC7r8L2eUtrTzCqEVRivDv";
const STATE_PATH = path.join(__dirname, "step3-deploy-state.json");
const CHUNK = 1000;
const BATCH = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txLink = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;

function loadKeypair(p) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/** Poll one signature until finalized/confirmed; throw on on-chain error. */
async function confirmSig(connection, sig, lastValidBlockHeight) {
  for (let i = 0; i < 90; i++) {
    const st = (
      await connection.getSignatureStatuses([sig], { searchTransactionHistory: true })
    ).value[0];
    if (st && (st.confirmationStatus === "finalized" || st.confirmationStatus === "confirmed")) {
      if (st.err) throw new Error(`tx failed on-chain: ${sig}: ${JSON.stringify(st.err)}`);
      return sig;
    }
    if (st && st.err) throw new Error(`tx failed on-chain: ${sig}: ${JSON.stringify(st.err)}`);
    if (lastValidBlockHeight && !st) {
      const h = await connection.getBlockHeight("confirmed");
      if (h > lastValidBlockHeight) return null; // blockhash expired, tx provably never landed
    }
    await sleep(2000);
  }
  throw new Error(`tx not confirmed via HTTP polling (status unknown — NOT resending): ${sig}`);
}

function writeIx(buffer, authority, offset, bytes) {
  const data = Buffer.alloc(4 + 4 + 8 + bytes.length);
  data.writeUInt32LE(1, 0); // UpgradeableLoaderInstruction::Write
  data.writeUInt32LE(offset, 4);
  data.writeBigUInt64LE(BigInt(bytes.length), 8);
  bytes.copy(data, 16);
  return new TransactionInstruction({
    programId: LOADER,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

(async () => {
  const tester = loadKeypair(TESTER_PATH);
  const programKp = loadKeypair(PROGRAM_KP_PATH);
  const programId = programKp.publicKey;
  const so = fs.readFileSync(SO_PATH);
  const soHash = crypto.createHash("sha256").update(so).digest("hex");
  const connection = new Connection(RPC, "confirmed");
  const state = {
    step: "step3-deploy",
    programId: programId.toBase58(),
    buffer: BUFFER.toBase58(),
    createBufferSignature: CREATE_BUFFER_SIG,
    soBytes: so.length,
    soSha256: soHash,
    writeSignatures: [],
    startedAt: new Date().toISOString(),
  };
  console.log("program:", programId.toBase58());
  console.log("tester:", tester.publicKey.toBase58());
  console.log(`.so: ${so.length} bytes sha256=${soHash}`);

  // --- Preflight (all reads, HTTPS) ---
  const balBefore = await connection.getBalance(tester.publicKey);
  state.testerSolBeforeLamports = balBefore;
  console.log(`tester balance before: ${balBefore} lamports (${balBefore / 1e9} SOL)`);

  const existing = await connection.getAccountInfo(programId);
  if (existing && existing.executable) {
    console.log("program account already exists and is executable — nothing to deploy.");
    state.alreadyDeployed = true;
    saveState(state);
    return;
  }
  if (existing) throw new Error("program account exists but is NOT executable — unexpected state, stopping");

  const bufInfo = await connection.getAccountInfo(BUFFER);
  if (!bufInfo) throw new Error("buffer account not found");
  if (!bufInfo.owner.equals(LOADER)) throw new Error("buffer not owned by the upgradeable loader");
  if (bufInfo.data.length !== 37 + so.length)
    throw new Error(`buffer dataLen ${bufInfo.data.length} != 37 + ${so.length}`);
  if (bufInfo.data.readUInt32LE(0) !== 1) throw new Error("buffer state tag != 1 (Buffer)");
  const bufAuthority = new PublicKey(bufInfo.data.subarray(5, 37));
  if (!bufAuthority.equals(tester.publicKey)) throw new Error("buffer authority is not the tester");
  console.log(`buffer verified: ${bufInfo.data.length} bytes, authority=tester, lamports=${bufInfo.lamports}`);

  // --- Write phase (batched; every signature recorded before polling) ---
  const totalChunks = Math.ceil(so.length / CHUNK);
  console.log(`writing ${totalChunks} chunks of <=${CHUNK} bytes in batches of ${BATCH}...`);
  for (let start = 0; start < totalChunks; start += BATCH) {
    const batchIdx = [];
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const sent = [];
    for (let c = start; c < Math.min(start + BATCH, totalChunks); c++) {
      const offset = c * CHUNK;
      const bytes = so.subarray(offset, Math.min(offset + CHUNK, so.length));
      const tx = new Transaction({ feePayer: tester.publicKey, recentBlockhash: blockhash });
      tx.add(writeIx(BUFFER, tester.publicKey, offset, bytes));
      tx.sign(tester);
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      sent.push({ chunk: c, offset, sig });
      batchIdx.push(c);
    }
    for (const s of sent) {
      let sig = await confirmSig(connection, s.sig, lastValidBlockHeight);
      if (sig === null) {
        // Blockhash expired with null status: the tx can never land.
        // Rebuild this single chunk with a fresh blockhash (proven-safe).
        console.log(`chunk ${s.chunk} expired unlanded (${s.sig}) — resending with fresh blockhash`);
        const fresh = await connection.getLatestBlockhash("confirmed");
        const offset = s.offset;
        const bytes = so.subarray(offset, Math.min(offset + CHUNK, so.length));
        const tx = new Transaction({ feePayer: tester.publicKey, recentBlockhash: fresh.blockhash });
        tx.add(writeIx(BUFFER, tester.publicKey, offset, bytes));
        tx.sign(tester);
        const sig2 = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });
        sig = await confirmSig(connection, sig2, fresh.lastValidBlockHeight);
        if (sig === null) throw new Error(`chunk ${s.chunk} expired twice — stopping`);
        state.writeSignatures.push({ chunk: s.chunk, offset: s.offset, signature: sig, resentFrom: s.sig });
      } else {
        state.writeSignatures.push({ chunk: s.chunk, offset: s.offset, signature: sig });
      }
    }
    saveState(state);
    console.log(`chunks ${batchIdx[0]}..${batchIdx[batchIdx.length - 1]} confirmed (${state.writeSignatures.length}/${totalChunks})`);
  }

  // --- Verify buffer contents byte-for-byte ---
  const bufAfter = await connection.getAccountInfo(BUFFER);
  const body = bufAfter.data.subarray(37);
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  console.log(`buffer body sha256=${bodyHash} match=${bodyHash === soHash}`);
  if (bodyHash !== soHash) throw new Error("buffer contents do not match the .so — stopping before deploy");
  state.bufferVerifiedSha256 = bodyHash;

  // --- Deploy phase ---
  const [programdata] = PublicKey.findProgramAddressSync([programId.toBuffer()], LOADER);
  state.programdata = programdata.toBase58();
  const programLamports = await connection.getMinimumBalanceForRentExemption(36);
  const deployData = Buffer.alloc(4 + 8);
  deployData.writeUInt32LE(2, 0); // UpgradeableLoaderInstruction::DeployWithMaxDataLen
  deployData.writeBigUInt64LE(BigInt(so.length), 4);
  const deployIx = new TransactionInstruction({
    programId: LOADER,
    keys: [
      { pubkey: tester.publicKey, isSigner: true, isWritable: true },
      { pubkey: programdata, isSigner: false, isWritable: true },
      { pubkey: programId, isSigner: false, isWritable: true },
      { pubkey: BUFFER, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tester.publicKey, isSigner: true, isWritable: false },
    ],
    data: deployData,
  });
  const createProgramIx = SystemProgram.createAccount({
    fromPubkey: tester.publicKey,
    newAccountPubkey: programId,
    lamports: programLamports,
    space: 36,
    programId: LOADER,
  });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const deployTx = new Transaction({ feePayer: tester.publicKey, recentBlockhash: blockhash });
  deployTx.add(createProgramIx, deployIx);
  deployTx.sign(tester, programKp);
  const deploySig = await connection.sendRawTransaction(deployTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  console.log("DEPLOY signature:", deploySig);
  console.log("DEPLOY tx:", txLink(deploySig));
  const confirmed = await confirmSig(connection, deploySig, lastValidBlockHeight);
  if (confirmed === null) throw new Error("deploy tx blockhash expired unlanded — status known-absent, stopping for manual review");
  state.deploySignature = deploySig;

  // --- Post-deploy verification ---
  const progInfo = await connection.getAccountInfo(programId);
  if (!progInfo || !progInfo.executable || !progInfo.owner.equals(LOADER))
    throw new Error("program account not executable/loader-owned after deploy");
  const pdFromProgram = new PublicKey(progInfo.data.subarray(4, 36));
  console.log(`program: executable=${progInfo.executable} owner=${progInfo.owner.toBase58()} programdata pointer matches=${pdFromProgram.equals(programdata)}`);
  const pdInfo = await connection.getAccountInfo(programdata);
  if (!pdInfo) throw new Error("programdata account missing after deploy");
  const pdTag = pdInfo.data.readUInt32LE(0);
  const pdSlot = pdInfo.data.readBigUInt64LE(4);
  const pdAuth = new PublicKey(pdInfo.data.subarray(13, 45));
  const pdBodyHash = crypto.createHash("sha256").update(pdInfo.data.subarray(45)).digest("hex");
  console.log(
    `programdata: tag=${pdTag} slot=${pdSlot} authority=${pdAuth.toBase58()} dataLen=${pdInfo.data.length} lamports=${pdInfo.lamports} bodySha256 match=${pdBodyHash === soHash}`
  );
  if (pdTag !== 3) throw new Error("programdata state tag != 3 (ProgramData)");
  if (pdBodyHash !== soHash) throw new Error("programdata body does not match the .so");
  state.programdataSlot = pdSlot.toString();
  state.programdataLamports = pdInfo.lamports;

  const balAfter = await connection.getBalance(tester.publicKey);
  state.testerSolAfterLamports = balAfter;
  state.testerSolSpentLamports = balBefore - balAfter;
  console.log(`tester balance after: ${balAfter} lamports — spent this script: ${balBefore - balAfter} lamports (${(balBefore - balAfter) / 1e9} SOL)`);
  state.finishedAt = new Date().toISOString();
  saveState(state);
  console.log("DEPLOY COMPLETE — state written to", STATE_PATH);
})().catch((e) => {
  console.error("FAILED:", e.message || e);
  if (e.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
