/**
 * Shared types for the FairOdds keeper.
 *
 * Data flow (docs/ARCHITECTURE.md §2/§4/§5):
 *   forecast/slate.py  ->  SlateEntry[]  ->  KeeperJob[]  ->  plan / live run
 *     1. commit_prediction  (ForecastRegistry, before trading opens)
 *     2. createMarket       (pm-AMM, custom seed = model probability)
 *     3. wait until endTs
 *     4. resolveMarket      (pm-AMM) + attest_resolution (ForecastRegistry)
 */

/** One market candidate exactly as emitted by forecast/slate.py. */
export interface SlateEntry {
  asset: string;
  question: string;
  /** USD threshold in the question ("close above $X"). */
  strike: number;
  /** USD spot price when the slate was generated. */
  spot: number;
  /** Model probability for YES, 0..1. */
  model_probability: number;
  /** Same probability in basis points (slate.py pre-computes it). */
  initial_price_bps: number;
  duration_secs: number;
  opens_at: number; // unix seconds
  expires_at: number; // unix seconds
  comparables_ess?: number;
  data_source?: string;
}

/** Shape of forecast/slate.json (and of slate.py --out files). */
export interface SlateFile {
  generated_at: number;
  markets: SlateEntry[];
}

/**
 * A keeper job: everything needed to commit, seed, resolve and attest one
 * market. Pure data — built and validated by src/jobs.ts.
 */
export interface KeeperJob {
  marketQuestion: string;
  asset: string;
  /** USD threshold (human units, as in the question). */
  strike: number;
  /**
   * Strike in Pyth-style raw integer units (exponent -8, see jobs.ts).
   * The registry stores this exact value; YES wins iff the observed raw
   * price at expiry is strictly greater than it (ARCHITECTURE.md §4).
   */
  strikeRaw: bigint;
  /** Model probability in bps — committed to ForecastRegistry. */
  probBps: number;
  /** pm-AMM custom seed in bps — identical to probBps by design. */
  initialPriceBps: number;
  opensAt: number; // unix seconds
  endTs: number; // unix seconds — market expiry; resolution happens after this
  durationSecs: number;
  modelVersion: string;
  /** Spot at slate time; used only for the dry-run's illustrative outcome. */
  spotAtSlate: number;
}
