"""FairOdds — daily market-slate generator.

Proposes the day's 24h threshold markets for SOL and BTC:

    "Will SOL close above $X in 24h?"

For each asset it scans candidate strikes around spot, prices every candidate
with the forecast engine (engine.py), keeps the ones whose model probability
sits in the tradable band [0.12, 0.88] (near-certain markets attract no flow),
and picks a spread of them (closest to p = 0.30 / 0.50 / 0.70 by default) so
the slate is balanced.  Each entry is emitted in the shape the keeper needs
for the pm-AMM custom-seed flow: initial_price_bps = model probability.

Usage:
    python3 slate.py [--per-asset 3] [--assets SOL,BTC] [--out slate.json]

Data: fresh hourly candles from the Coinbase Exchange public API; if the
fetch fails it falls back to backtest.py's prices_cache.json and says so.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import Pool, Series, forecast_probability
from backtest import fetch_coinbase, ASSETS, CACHE_PATH

HISTORY_DAYS = 45
DURATION_SECS = 24 * 3600
P_BAND = (0.12, 0.88)
TARGET_PS = (0.30, 0.50, 0.70)
STRIKE_STEP = {"SOL": 0.5, "BTC": 50.0}   # round strikes to market-friendly ticks


def round_strike(asset, price):
    step = STRIKE_STEP.get(asset, 0.5)
    return round(price / step) * step


def fmt_price(asset, price):
    return ("%0.0f" % price) if asset == "BTC" else ("%0.2f" % price)


def get_history(asset):
    """(closes, source_note) — fresh fetch, else backtest cache."""
    try:
        _, closes = fetch_coinbase(ASSETS[asset], HISTORY_DAYS)
        if len(closes) >= 24 * 14:
            return closes, "live Coinbase fetch"
    except Exception as exc:
        print("%s: live fetch failed (%s), trying cache" % (asset, exc))
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH) as f:
            cache = json.load(f)
        closes = cache["assets"][asset]["closes"]
        return closes, "backtest cache (may be stale)"
    raise RuntimeError("no price history available for %s" % asset)


def propose_asset(asset, per_asset):
    closes, source = get_history(asset)
    series = Series(closes)
    pool = Pool(series, 24)
    spot = closes[-1]

    candidates = []
    ratio = 0.90
    while ratio <= 1.1001:
        strike = round_strike(asset, spot * ratio)
        if strike > 0:
            p, diag = forecast_probability(closes, strike, 24, pool, series)
            if P_BAND[0] <= p <= P_BAND[1]:
                candidates.append({"strike": strike, "p": p, "diag": diag})
        ratio += 0.01
    # dedupe strikes that rounded to the same tick (keep the middle probability)
    by_strike = {}
    for c in candidates:
        by_strike.setdefault(c["strike"], []).append(c)
    candidates = [sorted(v, key=lambda c: c["p"])[len(v) // 2]
                  for _, v in sorted(by_strike.items())]

    picks = []
    for target in TARGET_PS[:per_asset]:
        if not candidates:
            break
        best = min(candidates, key=lambda c: abs(c["p"] - target))
        picks.append(best)
        candidates.remove(best)
    picks.sort(key=lambda c: c["strike"])

    now = int(time.time())
    entries = []
    for c in picks:
        strike = c["strike"]
        entries.append({
            "asset": asset,
            "question": "Will %s close above $%s in 24h?" % (asset, fmt_price(asset, strike)),
            "strike": strike,
            "spot": spot,
            "model_probability": round(c["p"], 4),
            "initial_price_bps": int(round(c["p"] * 10000)),
            "duration_secs": DURATION_SECS,
            "opens_at": now,
            "expires_at": now + DURATION_SECS,
            "comparables_ess": round(c["diag"]["effective_sample_size"], 1),
            "data_source": source,
        })
    return entries


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-asset", type=int, default=3)
    ap.add_argument("--assets", default="SOL,BTC")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "slate.json"))
    args = ap.parse_args()

    slate = []
    for asset in [a.strip() for a in args.assets.split(",") if a.strip()]:
        entries = propose_asset(asset, args.per_asset)
        slate.extend(entries)
        for e in entries:
            print("%-3s spot %10s | strike %10s | model p %.3f (%d bps) | ESS %.0f | %s"
                  % (e["asset"], fmt_price(asset, e["spot"]), fmt_price(asset, e["strike"]),
                     e["model_probability"], e["initial_price_bps"],
                     e["comparables_ess"], e["data_source"]))
    with open(args.out, "w") as f:
        json.dump({"generated_at": int(time.time()), "markets": slate}, f, indent=2)
    print("\n%d markets written to %s" % (len(slate), args.out))


if __name__ == "__main__":
    main()
