const fs = require("fs");
const path = require("path");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { AnchorProvider, Wallet } = require("@anchor-lang/core");
const { PmAmmClient } = require("@pm-amm/sdk");
const MUSDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const secret = Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "devnet-tester.keypair.json"), "utf8")));
const keypair = Keypair.fromSecretKey(secret);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: "confirmed" });
const client = PmAmmClient.fromProvider(provider, new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y"), MUSDC);
(async () => {
  const sp = path.join(__dirname, "lifecycle-state.json");
  const state = JSON.parse(fs.readFileSync(sp, "utf8"));
  const market = new PublicKey(state.market);
  const m = await client.fetchMarket(market);
  const now = Math.floor(Date.now() / 1000);
  console.log(JSON.stringify({
    now, endTs: Number(m.endTs), resolved: m.resolved, winningSide: String(m.winningSide),
    stateResolveSig: state.resolveSignature || null,
    stateClaimSig: state.claimSignature || null,
    stateMusdcClaimed: state.musdcClaimed ?? null,
  }));
})().catch(e => { console.error("OBSERVE FAILED:", e.message || e); process.exit(1); });
