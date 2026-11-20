/**
 * FairOdds keeper CLI.
 *
 *   npm run plan [-- --slate <path>] [--deposit <mUSDC>] [--out <file>]
 *
 * Default (and only executable) mode in this skeleton is the DRY-RUN plan:
 * it loads the forecast engine's slate, builds validated keeper jobs, and
 * prints the full ordered plan (commit -> create/seed -> wait -> resolve ->
 * attest) with every parameter. It sends NOTHING.
 *
 * --live is refused here, deliberately: this command is the dry-run plan.
 * Live execution is a separate, stateful, one-market-at-a-time runner
 * (src/liveRun.ts, `npm run live`) because it must run commit before create
 * (ARCHITECTURE.md §2), wait out the market, and attest — none of which
 * belongs in a plan printer. ForecastRegistry was deployed to devnet in
 * Step 3, so the runner's registry client carries a live transport; this
 * CLI's client never does.
 */
import fs from "node:fs";
import { jobFromSlateEntry } from "./jobs.js";
import { renderPlan, simulatedKey } from "./plan.js";
import { loadSlate } from "./slateSource.js";

function parseArgs(argv: string[]): {
  command: string;
  live: boolean;
  slate?: string;
  deposit: number;
  out?: string;
} {
  const [command = "plan", ...rest] = argv;
  let live = false;
  let slate: string | undefined;
  let deposit = 50; // mUSDC per market — matches the Day-2 lifecycle deposit
  let out: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--live") live = true;
    else if (a === "--slate") slate = rest[++i];
    else if (a === "--deposit") deposit = Number(rest[++i]);
    else if (a === "--out") out = rest[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return { command, live, slate, deposit, out };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== "plan") {
    throw new Error(`unknown command "${args.command}" (only "plan" exists in the skeleton)`);
  }
  if (args.live) {
    throw new Error(
      "REFUSED: the plan command is dry-run only. Live execution lives in the " +
        "dedicated runner (`npm run live`, src/liveRun.ts), which enforces the " +
        "commit-before-create ordering (ARCHITECTURE.md §2) and checkpoints its " +
        "state after every step. Run without --live for the dry-run plan.",
    );
  }

  const { slate, source } = loadSlate({ slatePath: args.slate });
  const jobs = slate.markets.map((e) => jobFromSlateEntry(e));
  const text = renderPlan(jobs, {
    depositUsdc: args.deposit,
    issuedAt: Math.floor(Date.now() / 1000),
    keeper: simulatedKey("keeper"),
    slateSource: source,
    slateGeneratedAt: slate.generated_at,
  });
  process.stdout.write(text);
  if (args.out) fs.writeFileSync(args.out, text);
}

main().catch((e) => {
  console.error("keeper FAILED:", e?.message ?? e);
  process.exit(1);
});
