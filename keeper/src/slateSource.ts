/**
 * Forecast adapter: obtain the engine's current slate.
 *
 * Preferred path: execute forecast/slate.py (it fetches fresh Coinbase
 * candles, falling back to its own prices_cache.json internally) writing to
 * a temp file so the checked-in forecast/slate.json is not clobbered.
 * Fallback path: if the Python engine cannot be executed in this
 * environment, read the existing forecast/slate.json output and say so —
 * the returned `source` string always states which path produced the slate
 * and is printed verbatim in the dry-run plan.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findProjectRoot } from "./registry.js";
import type { SlateFile } from "./types.js";

export interface SlateLoad {
  slate: SlateFile;
  /** Human-readable provenance, printed in the plan header. */
  source: string;
}

export function loadSlate(opts: { slatePath?: string } = {}): SlateLoad {
  const root = findProjectRoot();
  const forecastDir = path.join(root, "forecast");

  if (opts.slatePath) {
    const p = path.resolve(opts.slatePath);
    return {
      slate: JSON.parse(fs.readFileSync(p, "utf8")),
      source: `explicit --slate file ${p}`,
    };
  }

  const tmpOut = path.join(
    os.tmpdir(),
    `fairodds-slate-${process.pid}-${Date.now()}.json`,
  );
  try {
    execFileSync("python3", [path.join(forecastDir, "slate.py"), "--out", tmpOut], {
      cwd: forecastDir,
      timeout: 180_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const slate = JSON.parse(fs.readFileSync(tmpOut, "utf8"));
    return {
      slate,
      source: `forecast/slate.py executed fresh (engine output written to ${tmpOut})`,
    };
  } catch (e: any) {
    const existing = path.join(forecastDir, "slate.json");
    if (!fs.existsSync(existing)) {
      throw new Error(
        `slate.py failed (${e?.message ?? e}) and no existing forecast/slate.json to fall back to`,
      );
    }
    return {
      slate: JSON.parse(fs.readFileSync(existing, "utf8")),
      source:
        `EXISTING forecast/slate.json (slate.py could not be executed in this ` +
        `environment: ${(e?.message ?? String(e)).split("\n")[0]})`,
    };
  } finally {
    fs.rmSync(tmpOut, { force: true });
  }
}
