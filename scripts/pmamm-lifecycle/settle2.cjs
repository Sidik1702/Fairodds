const fs = require("fs");
const path = require("path");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { AnchorProvider, Wallet } = require("@anchor-lang/core");
const { PmAmmClient } = require("@pm-amm/sdk");
const { getAssociatedTokenAddressSync, getAccount } = require("@solana/spl-token");
const MUSDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const secret = Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "devnet-tester.keypair.json"), "utf8")));
const keypair = Keypair.fromSecretKey(secret);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: "confirmed" });
const client = PmAmmClient.fromProvider(provider, new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y"), MUSDC);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function bal(mint, owner) { try { return Number((await getAccount(connection, getAssociatedTokenAddressSync(mint, owner))).amount) / 1e6; } catch { return 0; } }
async function sendAndConfirmHttp(fn) {
  let sig = null;
  try { sig = await fn(); } catch (e) {
    const m = /signature ([A-Za-z0-9]{32,})/.exec(e.message || "");
    if (!m) throw e; sig = m[1];
  }
  for (let i = 0; i < 40; i++) {
    const st = (await connection.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
    if (st && (st.confirmationStatus === "finalized" || st.confirmationStatus === "confirmed")) {
      if (st.err) throw new Error("tx failed on-chain: " + JSON.stringify(st.err));
      return sig;
    }
    await sleep(3000);
  }
  throw new Error("tx not confirmed via HTTP polling: " + sig);
}
(async () => {
  const sp = path.join(__dirname, "lifecycle-state.json");
  const state = JSON.parse(fs.readFileSync(sp, "utf8"));
  const market = new PublicKey(state.market);
  const yesBal = await bal(client.yesMint(market), keypair.publicKey);
  console.log("YES balance before settle:", yesBal); state.yesBalanceAfterSwap = yesBal;
  for (;;) {
    const m = await client.fetchMarket(market);
    const now = Math.floor(Date.now() / 1000);
    console.log(`now=${now} endTs=${Number(m.endTs)} resolved=${m.resolved}`);
    if (m.resolved || now >= Number(m.endTs)) break;
    await sleep(20000);
  }
  let m = await client.fetchMarket(market);
  if (!m.resolved) {
    const sig = await sendAndConfirmHttp(() => client.send.resolveMarket(market, "yes"));
    console.log("RESOLVE signature:", sig); state.resolveSignature = sig;
    m = await client.fetchMarket(market);
    console.log("post-resolve: resolved=%s winningSide=%s", m.resolved, m.winningSide);
  }
  const before = await bal(MUSDC, keypair.publicKey);
  const csig = await sendAndConfirmHttp(() => client.send.claimWinnings(market));
  console.log("CLAIM signature:", csig); state.claimSignature = csig;
  const after = await bal(MUSDC, keypair.publicKey);
  console.log(`mUSDC before=${before} after=${after} claimed=${after - before}`);
  state.musdcClaimed = after - before;
  fs.writeFileSync(sp, JSON.stringify(state, null, 2));
  console.log("DONE — full lifecycle complete.");
})().catch(e => { console.error("FAILED:", e.message || e); process.exit(1); });
