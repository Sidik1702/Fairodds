/**
 * smoke.cjs — headless render check for the FairOdds demo app.
 *
 * Serves the production build with `vite preview`, renders it in the
 * sandbox's headless Chrome (puppeteer cache), and asserts the rendered
 * DOM contains the REAL Step-3 on-chain values (prob 6200 bps / 62.00%,
 * Brier 0.1444, the record + market addresses and names). The page first
 * renders public/data.json (fetched live by scripts/fetch-data.cjs) and
 * then tries an in-browser live refresh — either provenance is accepted,
 * and the one that rendered is reported.
 *
 * Evidence written to examples/: smoke-dom.html, smoke-screenshot.png.
 * Run: npm run smoke   (after npm run fetch-data && npm run build)
 */
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const APP_DIR = path.join(__dirname, "..");
const EXAMPLES = path.join(APP_DIR, "examples");
const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}/`;

function findChrome() {
  const cache = path.join(process.env.HOME, ".cache", "puppeteer");
  const candidates = [];
  for (const product of ["chrome", "chrome-headless-shell"]) {
    const dir = path.join(cache, product);
    if (!fs.existsSync(dir)) continue;
    for (const ver of fs.readdirSync(dir)) {
      candidates.push(
        path.join(dir, ver, "chrome-linux64", "chrome"),
        path.join(dir, ver, "chrome-headless-shell-linux64", "chrome-headless-shell"),
      );
    }
  }
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("no headless Chrome found in ~/.cache/puppeteer");
  return found;
}

function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http
        .get(URL, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else retry();
        })
        .on("error", retry);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) reject(new Error("preview server did not come up"));
      else setTimeout(tick, 400);
    };
    tick();
  });
}

function runChrome(chrome, args) {
  return new Promise((resolve, reject) => {
    execFile(chrome, args, { maxBuffer: 64 * 1024 * 1024, timeout: 120000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

const ASSERTIONS = [
  ["record prob percent", "62.00%"],
  ["record prob bps", "6200 bps"],
  ["record Brier", "0.1444"],
  ["record Brier e8", "14440000"],
  ["record address", "AJdwPfYkg3577B46VjPhAfVV7r1dnXryQkN5uEVquALq"],
  ["step-3 market address", "3KhWpiKLmWt4DJn4EbBJfRFK5M68Dpz5yto8HKd7zvAu"],
  ["day-2 market address", "9mxS9rrZekcwvFPVo1nVqqNxNiE9PExhuSvyqzh3Vxni"],
  ["step-3 market name", "FairOdds live: SOL above $68.50 in 6 min? (seed 62%)"],
  ["day-2 market name", "FairOdds smoke: SOL up in 5 min? (model seed 62%)"],
  ["strike", "$68.50"],
  ["observed price", "$68.58"],
  ["team name", "Pasukan Satset"],
  ["baseline", "0.2500"],
];

async function main() {
  const chrome = findChrome();
  console.log("chrome:", chrome);
  // Spawn vite's bin directly (not npx) so kill() reaches the real server,
  // and pin --host 127.0.0.1: vite preview otherwise binds ::1 only here.
  const preview = spawn(
    process.execPath,
    [
      path.join(APP_DIR, "node_modules", "vite", "bin", "vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(PORT),
      "--strictPort",
    ],
    { cwd: APP_DIR, stdio: "pipe" },
  );
  try {
    await waitForServer();
    console.log("preview server up:", URL);

    const dom = await runChrome(chrome, [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--virtual-time-budget=25000",
      "--dump-dom",
      URL,
    ]);
    fs.writeFileSync(path.join(EXAMPLES, "smoke-dom.html"), dom);
    console.log(`DOM saved (${dom.length} bytes)`);

    const shot = path.join(EXAMPLES, "smoke-screenshot.png");
    await runChrome(chrome, [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--virtual-time-budget=25000",
      `--screenshot=${shot}`,
      "--window-size=1280,2400",
      URL,
    ]);
    console.log("screenshot saved:", shot, fs.statSync(shot).size, "bytes");

    let failed = 0;
    for (const [label, needle] of ASSERTIONS) {
      const ok = dom.includes(needle);
      console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(needle)}`);
      if (!ok) failed++;
    }
    const provenance = dom.includes("Live from Solana devnet")
      ? "LIVE in-browser refresh"
      : dom.includes("Snapshot fetched live from Solana devnet")
        ? "snapshot (scripts/fetch-data.cjs)"
        : "UNKNOWN";
    console.log("provenance rendered:", provenance);
    if (failed > 0) {
      console.error(`SMOKE FAILED: ${failed} assertion(s)`);
      process.exit(1);
    }
    console.log("SMOKE PASSED — all assertions present in the rendered DOM");
  } finally {
    preview.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error("smoke FAILED:", e);
  process.exit(1);
});
