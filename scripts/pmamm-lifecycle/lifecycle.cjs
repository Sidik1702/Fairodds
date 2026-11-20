/**
 * FairOdds — pm-AMM devnet lifecycle smoke test (plan slot: Nov 20).
 *
 * Runs the pm-AMM end-to-end on DEVNET via @pm-amm/sdk:
 *   create a custom-seeded binary market -> swap USDC->YES ->
 *   (wait for expiry) -> resolve -> claim winnings.
 *
 * Usage:
 *   node lifecycle.cjs create   # preflight + create market + swap; writes state
 *   node lifecycle.cjs settle   # waits for end_ts, resolves YES, claims
 *
 * Devnet only. Collateral is mock USDC (mUSDC). Keypair is the throwaway
 * devnet tester at ../../devnet-tester.keypair.json (gitignored).
 */
const fs = require("fs");
const path = require("path");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { AnchorProvider, Wallet } = require("@anchor-lang/core");
const { PmAmmClient } = require("@pm-amm/sdk");
const {
  getAssociatedTokenAddressSync,
  getAccount,
} = require("@solana/spl-token");

const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const MUSDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const KEYPAIR_PATH = path.join(__dirname, "..", "..", "devnet-tester.keypair.json");
const STATE_PATH = path.join(__dirname, "lifecycle-state.json");

// FairOdds thesis in one market: seeded at a model-style fair price (62%),
// NOT the default 50/50. Minimum on-chain duration is 300 s.
const MARKET = {
  name: "FairOdds smoke: SOL up in 5 min? (model seed 62%)",
  durationSecs: 360,
  initialPriceBps: 6200,
  depositUsdc: 50, // human units
};
const SWAP_IN_MICRO = 5_000_000; // 5 mUSDC, raw units (send.swap is raw)

const txLink = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const addrLink = (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadClient() {
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")));
  const keypair = Keypair.fromSecretKey(secret);
  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(keypair), {
    commitment: "confirmed",
  });
  const client = PmAmmClient.fromProvider(provider, PROGRAM_ID, MUSDC);
  return { connection, keypair, client };
}

async function tokenBalance(connection, mint, owner) {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  try {
    const acct = await getAccount(connection, ata);
    return Number(acct.amount) / 1e6;
  } catch {
    return 0;
  }
}

async function create() {
  const { connection, keypair, client } = loadClient();
  const me = keypair.publicKey;
  console.log("wallet:", me.toBase58(), addrLink(me.toBase58()));

  // Preflight: verify funds on-chain before sending anything.
  const sol = (await connection.getBalance(me)) / 1e9;
  const musdc = await tokenBalance(connection, MUSDC, me);
  console.log(`preflight: ${sol} SOL, ${musdc} mUSDC`);
  if (sol < 0.05) throw new Error(`insufficient devnet SOL (${sol}); airdrop first`);
  if (musdc < MARKET.depositUsdc + 5) throw new Error(`insufficient mUSDC (${musdc})`);

  // 1) Create the market (custom seed = "model probability", bundled LP deposit).
  const created = await client.send.createMarket({ ...MARKET });
  const market = new PublicKey(created.marketPda);
  console.log("CREATE signature:", created.signature);
  console.log("CREATE tx:", txLink(created.signature));
  console.log("market id:", created.marketId);
  console.log("market:", market.toBase58(), addrLink(market.toBase58()));

  const state0 = await client.fetchMarket(market);
  console.log(
    "market state: endTs=%s resolved=%s winningSide=%s",
    state0.endTs?.toString(),
    state0.resolved,
    state0.winningSide
  );

  // 2) Swap 5 mUSDC -> YES (raw units; minOutput 0 = smoke-test, no slippage guard).
  const swapSig = await client.send.swap(market, "usdcToYes", SWAP_IN_MICRO, 0);
  console.log("SWAP signature:", swapSig);
  console.log("SWAP tx:", txLink(swapSig));

  const yesMint = client.yesMint(market);
  const yesBal = await tokenBalance(connection, yesMint, me);
  const musdcAfter = await tokenBalance(connection, MUSDC, me);
  console.log(`after swap: YES balance=${yesBal}, mUSDC=${musdcAfter}`);

  const state = {
    market: market.toBase58(),
    marketId: created.marketId,
    createSignature: created.signature,
    swapSignature: swapSig,
    endTs: Number(state0.endTs),
    yesBalanceAfterSwap: yesBal,
    musdcAfterSwap: musdcAfter,
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log("state written to", STATE_PATH);
}

async function settle() {
  const { connection, keypair, client } = loadClient();
  const me = keypair.publicKey;
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const market = new PublicKey(state.market);

  // 3) Wait for expiry, then resolve as the market authority (creator).
  for (;;) {
    const m = await client.fetchMarket(market);
    const now = Math.floor(Date.now() / 1000);
    const endTs = Number(m.endTs);
    console.log(`now=${now} endTs=${endTs} resolved=${m.resolved} winningSide=${m.winningSide}`);
    if (m.resolved) break;
    if (now >= endTs) break;
    await sleep(Math.min((endTs - now + 2) * 1000, 30000));
  }

  let m = await client.fetchMarket(market);
  if (!m.resolved) {
    const resolveSig = await client.send.resolveMarket(market, "yes");
    console.log("RESOLVE signature:", resolveSig);
    console.log("RESOLVE tx:", txLink(resolveSig));
    state.resolveSignature = resolveSig;
    m = await client.fetchMarket(market);
    console.log("post-resolve: resolved=%s winningSide=%s (1=YES)", m.resolved, m.winningSide);
  }

  // 4) Claim winnings: YES tokens redeem 1:1 for mUSDC.
  const before = await tokenBalance(connection, MUSDC, me);
  const claimSig = await client.send.claimWinnings(market);
  console.log("CLAIM signature:", claimSig);
  console.log("CLAIM tx:", txLink(claimSig));
  const after = await tokenBalance(connection, MUSDC, me);
  console.log(`mUSDC before claim=${before} after claim=${after} (claimed ${after - before})`);
  state.claimSignature = claimSig;
  state.musdcClaimed = after - before;
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log("DONE — full lifecycle complete.");
}

(async () => {
  const phase = process.argv[2];
  if (phase === "create") await create();
  else if (phase === "settle") await settle();
  else throw new Error("usage: node lifecycle.cjs create|settle");
})().catch((e) => {
  console.error("FAILED:", e.message || e);
  if (e.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
