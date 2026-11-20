"""FairOdds forecast engine v1 — kernel-weighted comparables in log-ratio space.

Adapted from the kernel-weighted log-ratio forecaster used for the make.fun
GTA VI Twitch CCU forecast (LOO loss 0.186 vs 0.283 house baseline), retargeted
at short-horizon crypto threshold questions:

    "Will ASSET close above STRIKE in HORIZON hours?"

Method
------
Everything happens in log space.  For a forecast origin t with spot price P_t
and strike X, the question is whether the forward log-return
``f = log(P_{t+H} / P_t)`` exceeds the threshold log-ratio ``L = log(X / P_t)``.

Instead of assuming a parametric distribution for f, we look at *comparable*
historical origins s: moments whose recent path "looked like" the present one.
Each comparable contributes its realized forward log-return f_s, weighted by a
Gaussian kernel over a standardized feature distance between the path ending
at s and the path ending at t.  Features (all in log space):

    r6, r24, r72, r168   trailing log-returns (trend at 4 scales)
    vol24, vol168        realized vol of hourly log-returns (regime)

The probability is the kernel-weighted empirical CDF of the comparables'
forward log-returns evaluated at L, shrunk toward the unconditional base rate
with a pseudo-count weight (so a thin comparable set cannot produce wild
probabilities), and clipped to [0.01, 0.99].

Pure Python 3 stdlib.  No numpy/pandas.
"""

from __future__ import annotations

import math
from bisect import bisect_right

HORIZON_DEFAULT = 24          # hours
LOOKBACKS = (6, 24, 72, 168)  # trailing log-return windows (hours)
VOL_WINDOWS = (24, 168)       # realized-vol windows (hours)
MAX_LOOKBACK = max(max(LOOKBACKS), max(VOL_WINDOWS))
BANDWIDTH = 1.1               # Gaussian kernel width, in standardized units
SHRINKAGE_K = 30.0            # pseudo-counts pulling toward the base rate
P_MIN, P_MAX = 0.01, 0.99


# --------------------------------------------------------------------------
# Feature extraction
# --------------------------------------------------------------------------

class Series:
    """Precomputed log-price series with O(1) window statistics."""

    def __init__(self, closes):
        if len(closes) < MAX_LOOKBACK + 2:
            raise ValueError("series too short for the feature lookbacks")
        self.closes = [float(c) for c in closes]
        self.logp = [math.log(c) for c in self.closes]
        # hourly log-returns r[i] = logp[i] - logp[i-1], r[0] = 0 placeholder
        rets = [0.0] + [self.logp[i] - self.logp[i - 1]
                        for i in range(1, len(self.logp))]
        self._cum = [0.0]
        self._cum2 = [0.0]
        for r in rets:
            self._cum.append(self._cum[-1] + r)
            self._cum2.append(self._cum2[-1] + r * r)

    def __len__(self):
        return len(self.closes)

    def _window_std(self, t, w):
        """Std of hourly log-returns over the w hours ending at index t."""
        # returns indexed (t-w+1 .. t) in rets[] == positions in cum arrays
        s1 = self._cum[t + 1] - self._cum[t + 1 - w]
        s2 = self._cum2[t + 1] - self._cum2[t + 1 - w]
        mean = s1 / w
        var = s2 / w - mean * mean
        return math.sqrt(var) if var > 0.0 else 0.0

    def features(self, t):
        """Feature vector for the path ending at index t (needs t >= 168)."""
        lp = self.logp
        feats = [lp[t] - lp[t - k] for k in LOOKBACKS]
        feats += [self._window_std(t, w) for w in VOL_WINDOWS]
        return feats


# --------------------------------------------------------------------------
# Comparables pool
# --------------------------------------------------------------------------

class Pool:
    """All historical origins with features + realized forward log-returns.

    An origin s is usable for a forecast made at time t only if its forward
    window is fully observed by then: s + horizon <= t.  Origins are stored
    sorted by s, so the eligible set for t is a prefix (found via bisect).
    """

    def __init__(self, series: Series, horizon: int = HORIZON_DEFAULT):
        self.horizon = horizon
        self.starts = []     # origin index s
        self.feats = []      # feature vector at s
        self.fwd = []        # realized forward log-return log(P_{s+H}/P_s)
        lp = series.logp
        for s in range(MAX_LOOKBACK, len(series) - horizon):
            self.starts.append(s)
            self.feats.append(series.features(s))
            self.fwd.append(lp[s + horizon] - lp[s])

    def eligible_count(self, t):
        """Number of pool origins whose forward return is known by time t."""
        return bisect_right(self.starts, t - self.horizon)


# --------------------------------------------------------------------------
# Forecaster
# --------------------------------------------------------------------------

def _norm_cdf(z):
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def kernel_weights(pool: Pool, current_feats, t, bandwidth: float = BANDWIDTH):
    """Kernel weights of the eligible comparables for a forecast at time t.

    Strike-independent: compute once per origin, then evaluate any number of
    threshold log-ratios with prob_from_weights().  Returns (weights, n, ess)
    where weights[i] aligns with pool.feats[i] / pool.fwd[i] for i < n.
    """
    n = pool.eligible_count(t)
    if n < 50:
        raise ValueError("not enough eligible comparables yet")
    feats = pool.feats[:n]
    dim = len(current_feats)

    # Standardize by the eligible pool's per-feature std.
    stds = []
    for j in range(dim):
        m = sum(f[j] for f in feats) / n
        v = sum((f[j] - m) ** 2 for f in feats) / n
        stds.append(math.sqrt(v) if v > 1e-18 else 1.0)

    inv = 1.0 / (2.0 * bandwidth * bandwidth)
    weights = []
    w_sum = 0.0
    w2_sum = 0.0
    for f in feats:
        d2 = 0.0
        for j in range(dim):
            z = (f[j] - current_feats[j]) / stds[j]
            d2 += z * z
        w = math.exp(-d2 * inv)
        weights.append(w)
        w_sum += w
        w2_sum += w * w
    ess = (w_sum * w_sum / w2_sum) if w2_sum > 0 else 0.0
    return weights, n, ess


def prob_from_weights(weights, fwd_prefix, log_ratio, ess,
                      shrinkage_k: float = SHRINKAGE_K):
    """Shrunk kernel estimate of P(forward log-return > log_ratio)."""
    w_sum = sum(weights)
    hit = 0.0
    base_hits = 0
    for w, fr in zip(weights, fwd_prefix):
        if fr > log_ratio:
            hit += w
            base_hits += 1
    n = len(fwd_prefix)
    p_kernel = hit / w_sum if w_sum > 0 else 0.5
    p_base = base_hits / n
    p = (ess * p_kernel + shrinkage_k * p_base) / (ess + shrinkage_k)
    p = min(P_MAX, max(P_MIN, p))
    return p, {"p_kernel": p_kernel, "p_base_rate": p_base,
               "effective_sample_size": ess, "n_comparables": n}


def kernel_probability(pool: Pool, current_feats, log_ratio, t,
                       bandwidth: float = BANDWIDTH,
                       shrinkage_k: float = SHRINKAGE_K):
    """Kernel-weighted P(forward log-return > log_ratio) as seen at time t.

    Returns (probability, diagnostics dict).
    """
    weights, n, ess = kernel_weights(pool, current_feats, t, bandwidth)
    return prob_from_weights(weights, pool.fwd[:n], log_ratio, ess, shrinkage_k)


def forecast_probability(closes, strike, horizon: int = HORIZON_DEFAULT,
                         pool: Pool | None = None, series: Series | None = None):
    """P(close in `horizon` hours > strike) using the latest close as origin.

    `closes` is the full history of hourly closes ending "now".  Pass a
    prebuilt `pool`/`series` to reuse work across many strikes (slate.py and
    backtest.py do); otherwise they are built here.
    """
    if series is None:
        series = Series(closes)
    if pool is None:
        pool = Pool(series, horizon)
    t = len(series) - 1
    spot = series.closes[t]
    log_ratio = math.log(strike / spot)
    p, diag = kernel_probability(pool, series.features(t), log_ratio, t)
    diag.update({"spot": spot, "strike": strike, "log_ratio": log_ratio,
                 "horizon_hours": horizon})
    return p, diag


# --------------------------------------------------------------------------
# Naive momentum baseline (used by backtest.py)
# --------------------------------------------------------------------------

def momentum_probability(series: Series, t, strike, horizon: int = HORIZON_DEFAULT):
    """Naive momentum forecaster: forward log-return ~ Normal(mu, sigma^2)
    with mu = trailing 24h log-return (trend continues) and sigma = trailing
    24h realized vol scaled to the horizon."""
    lp = series.logp
    mu = lp[t] - lp[t - 24]
    sigma = series._window_std(t, 24) * math.sqrt(horizon)
    if sigma <= 0:
        return 0.5
    log_ratio = math.log(strike / series.closes[t])
    return min(P_MAX, max(P_MIN, _norm_cdf((mu - log_ratio) / sigma)))
