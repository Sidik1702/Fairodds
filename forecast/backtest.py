"""FairOdds forecast engine — walk-forward backtest.

Data: hourly closes from the Coinbase Exchange public API (no key needed),
cached to prices_cache.json next to this file.  If the fetch fails entirely,
a synthetic regime-switching series is generated instead and the report is
flagged as synthetic (see REPORT.md).

Walk-forward protocol (no look-ahead):
  * Burn-in: the first BURN_IN_HOURS only seed the comparables pool.
  * Test origins every STEP_HOURS after burn-in.  At origin t the model's
    pool contains only origins s with s + horizon <= t (forward return fully
    realized by t) — exactly the information available live.
  * At each origin, strikes = spot x STRIKE_RATIOS; outcome = 1 if the close
    at t + HORIZON exceeds the strike.
  * Forecasters scored: FairOdds kernel model, naive momentum (engine.py),
    flat 50% coin flip (Brier is exactly 0.25 by construction), and the
    unconditional base rate of the eligible pool.

Outputs: printed summary + results.json (Brier scores, calibration table).
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import (Pool, Series, kernel_weights, prob_from_weights,
                    momentum_probability)

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.join(HERE, "prices_cache.json")
RESULTS_PATH = os.path.join(HERE, "results.json")

ASSETS = {"SOL": "SOL-USD", "BTC": "BTC-USD"}
DAYS = 180
HORIZON = 24
BURN_IN_HOURS = 21 * 24          # 3 weeks of pool before the first forecast
STEP_HOURS = 6                   # forecast cadence in the backtest
STRIKE_RATIOS = (0.95, 0.975, 1.0, 1.025, 1.05)


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------

def fetch_coinbase(product, days):
    """Hourly closes for `product`, oldest -> newest, via public candles."""
    end = int(time.time())
    start = end - days * 86400
    by_ts = {}
    chunk = 290 * 3600  # API caps at 300 candles per request
    t = start
    while t < end:
        e = min(t + chunk, end)
        url = ("https://api.exchange.coinbase.com/products/%s/candles"
               "?granularity=3600&start=%d&end=%d" % (product, t, e))
        req = urllib.request.Request(url, headers={"User-Agent": "fairodds/0.1"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            rows = json.load(resp)
        for row in rows:  # [time, low, high, open, close, volume]
            by_ts[int(row[0])] = float(row[4])
        t = e
        time.sleep(0.25)
    stamps = sorted(by_ts)
    return stamps, [by_ts[s] for s in stamps]


def synthetic_series(n, seed):
    """Fallback: regime-switching GBM hourly closes (clearly synthetic)."""
    import random
    rng = random.Random(seed)
    price = 100.0
    closes = []
    regime = 0
    mus = (-0.0004, 0.0, 0.0005)
    sigmas = (0.004, 0.010, 0.022)
    for _ in range(n):
        if rng.random() < 0.004:
            regime = rng.randrange(3)
        price *= math.exp(mus[regime] + sigmas[regime] * rng.gauss(0, 1))
        closes.append(price)
    return closes


def load_data():
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH) as f:
            cache = json.load(f)
        if cache.get("days") == DAYS and all(a in cache["assets"] for a in ASSETS):
            return cache["assets"], cache.get("source", "cache")
    assets = {}
    source = "Coinbase Exchange public API (hourly candles)"
    try:
        for name, product in ASSETS.items():
            stamps, closes = fetch_coinbase(product, DAYS)
            if len(closes) < 24 * 60:
                raise RuntimeError("too little data for %s" % name)
            assets[name] = {"timestamps": stamps, "closes": closes}
    except Exception as exc:  # network blocked etc. -> synthetic fallback
        print("FETCH FAILED (%s) — falling back to SYNTHETIC data" % exc)
        source = "SYNTHETIC (fetch failed: %s)" % exc
        assets = {name: {"timestamps": [], "closes": synthetic_series(DAYS * 24, 42 + i)}
                  for i, name in enumerate(ASSETS)}
    with open(CACHE_PATH, "w") as f:
        json.dump({"days": DAYS, "source": source, "assets": assets}, f)
    return assets, source


# --------------------------------------------------------------------------
# Backtest
# --------------------------------------------------------------------------

def brier(rows, key):
    return sum((r[key] - r["outcome"]) ** 2 for r in rows) / len(rows)


def calibration(rows, key, bins=10):
    table = []
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        sel = [r for r in rows if lo <= r[key] < hi or (b == bins - 1 and r[key] == 1.0)]
        if not sel:
            table.append({"bucket": "%.1f-%.1f" % (lo, hi), "n": 0,
                          "mean_pred": None, "realized_freq": None})
            continue
        table.append({
            "bucket": "%.1f-%.1f" % (lo, hi),
            "n": len(sel),
            "mean_pred": sum(r[key] for r in sel) / len(sel),
            "realized_freq": sum(r["outcome"] for r in sel) / len(sel),
        })
    return table


def run_asset(name, closes):
    series = Series(closes)
    pool = Pool(series, HORIZON)
    rows = []
    n = len(series)
    for t in range(BURN_IN_HOURS, n - HORIZON, STEP_HOURS):
        spot = series.closes[t]
        outcome_close = series.closes[t + HORIZON]
        feats = series.features(t)
        # Kernel weights are strike-independent: compute once per origin.
        weights, n_pool, ess = kernel_weights(pool, feats, t)
        fwd_prefix = pool.fwd[:n_pool]
        for ratio in STRIKE_RATIOS:
            strike = spot * ratio
            log_ratio = math.log(ratio)
            p_model, diag = prob_from_weights(weights, fwd_prefix, log_ratio, ess)
            rows.append({
                "asset": name,
                "t_index": t,
                "strike_ratio": ratio,
                "p_model": p_model,
                "p_momentum": momentum_probability(series, t, strike, HORIZON),
                "p_base": diag["p_base_rate"],
                "p_coinflip": 0.5,
                "outcome": 1 if outcome_close > strike else 0,
            })
    return rows


def main():
    assets, source = load_data()
    print("Data source: %s" % source)
    all_rows = []
    per_asset = {}
    for name, blob in assets.items():
        closes = blob["closes"]
        rows = run_asset(name, closes)
        all_rows.extend(rows)
        per_asset[name] = {
            "n_hours": len(closes),
            "n_forecasts": len(rows),
            "brier_model": brier(rows, "p_model"),
            "brier_momentum": brier(rows, "p_momentum"),
            "brier_base_rate": brier(rows, "p_base"),
            "price_first": closes[0],
            "price_last": closes[-1],
        }
        print("%s: %d hourly closes (%0.2f -> %0.2f), %d forecasts"
              % (name, len(closes), closes[0], closes[-1], len(rows)))

    by_strike = {}
    for ratio in STRIKE_RATIOS:
        sel = [r for r in all_rows if r["strike_ratio"] == ratio]
        by_strike[str(ratio)] = {
            "n": len(sel),
            "brier_model": brier(sel, "p_model"),
            "brier_momentum": brier(sel, "p_momentum"),
            "brier_base_rate": brier(sel, "p_base"),
            "realized_yes_rate": sum(r["outcome"] for r in sel) / len(sel),
        }

    results = {
        "data_source": source,
        "days": DAYS,
        "horizon_hours": HORIZON,
        "strike_ratios": STRIKE_RATIOS,
        "n_forecasts_total": len(all_rows),
        "per_asset": per_asset,
        "by_strike_ratio": by_strike,
        "overall": {
            "brier_model": brier(all_rows, "p_model"),
            "brier_momentum": brier(all_rows, "p_momentum"),
            "brier_base_rate": brier(all_rows, "p_base"),
            "brier_coinflip": brier(all_rows, "p_coinflip"),
        },
        "calibration_model": calibration(all_rows, "p_model"),
        "calibration_momentum": calibration(all_rows, "p_momentum"),
    }
    with open(RESULTS_PATH, "w") as f:
        json.dump(results, f, indent=2)

    o = results["overall"]
    print("\n=== BRIER SCORES (lower is better) ===")
    print("FairOdds kernel model : %.4f" % o["brier_model"])
    print("Naive momentum        : %.4f" % o["brier_momentum"])
    print("Unconditional base rate: %.4f" % o["brier_base_rate"])
    print("Coin flip (flat 50%%)  : %.4f" % o["brier_coinflip"])
    print("\n=== CALIBRATION — model (predicted vs realized) ===")
    print("%-10s %6s %10s %10s" % ("bucket", "n", "mean_pred", "realized"))
    for row in results["calibration_model"]:
        if row["n"]:
            print("%-10s %6d %10.3f %10.3f"
                  % (row["bucket"], row["n"], row["mean_pred"], row["realized_freq"]))
        else:
            print("%-10s %6d %10s %10s" % (row["bucket"], 0, "-", "-"))
    print("\nWrote %s" % RESULTS_PATH)


if __name__ == "__main__":
    main()
