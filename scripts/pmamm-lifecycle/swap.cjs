const fs = require("fs");
const path = require("path");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { AnchorProvider, Wallet } = require("@anchor-lang/core");
const { PmAmmClient } = require("@pm-amm/sdk");
const { getAssociatedTokenAddressSync, getAccount } = require("@solana/spl-token");
const secret = Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "devnet-tester.keypair.json"), "utf8")));
const keypair = Keypair.fromSecretKey(secret);
const connection = new Connection("https://api.devnet.solana.com", { commitment: "confirmed", wsEndpoint: undefined });
const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: "confirmed" });
const client = PmAmmClient.fromProvider(provider, new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y"), new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ"));
(async () => {
  const market = new PublicKey("9mxS9rrZekcwvFPVo1nVqqNxNiE9PExhuSvyqzh3Vxni");
  const sig = await client.send.swap(market, "usdcToYes", 5_000_000, 0);
  console.log("SWAP signature:", sig);
  const yesMint = client.yesMint(market);
  const ata = getAssociatedTokenAddressSync(yesMint, keypair.publicKey);
  let bal = 0; try { bal = Number((await getAccount(connection, ata)).amount) / 1e6; } catch {}
  console.log("YES balance:", bal);
  const sp = path.join(__dirname, "lifecycle-state.json");
  const state = JSON.parse(fs.readFileSync(sp, "utf8"));
  state.swapSignature = sig; state.yesBalanceAfterSwap = bal;
  fs.writeFileSync(sp, JSON.stringify(state, null, 2));
  console.log("state updated");
})().catch(e => { console.error("FAILED:", e.message || e); process.exit(1); });
