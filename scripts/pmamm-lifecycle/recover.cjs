const fs = require("fs");
const path = require("path");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { AnchorProvider, Wallet } = require("@anchor-lang/core");
const { PmAmmClient } = require("@pm-amm/sdk");
const secret = Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "devnet-tester.keypair.json"), "utf8")));
const keypair = Keypair.fromSecretKey(secret);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: "confirmed" });
const client = PmAmmClient.fromProvider(provider, new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y"), new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ"));
(async () => {
  const market = new PublicKey("9mxS9rrZekcwvFPVo1nVqqNxNiE9PExhuSvyqzh3Vxni");
  const m = await client.fetchMarket(market);
  const now = Math.floor(Date.now() / 1000);
  console.log("endTs:", Number(m.endTs), "now:", now, "resolved:", m.resolved, "winningSide:", m.winningSide);
  const state = { market: market.toBase58(), marketId: null, createSignature: "4eH5HU77ZF5nZ7QpUs3bqBe1EtQfS9jZ2h3Q4cWRD8iwRur99JofBUxRMR7hhjSKBDvF3j8VpxJxydkYtAbyXd4L", swapSignature: null, endTs: Number(m.endTs), recoveredAfterWsTimeout: true };
  fs.writeFileSync(path.join(__dirname, "lifecycle-state.json"), JSON.stringify(state, null, 2));
  console.log("state written");
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
