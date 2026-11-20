//! ForecastRegistry — FairOdds' on-chain track-record program.
//!
//! Purpose (see docs/ARCHITECTURE.md and ../PLAN.md):
//! - `commit_prediction`: the keeper commits the forecast engine's prediction
//!   (market, model probability in bps, strike, model version, hash) on-chain
//!   BEFORE trading opens on the corresponding pm-AMM market. This makes the
//!   model's track record tamper-proof: a prediction cannot be edited after
//!   the outcome is known.
//! - `attest_resolution`: after the market's resolution is knowable, the
//!   forecaster posts the realized outcome (derived from the Pyth price feed)
//!   against the committed prediction, and the program computes the Brier
//!   score contribution in-program. Anyone can recompute the model's Brier
//!   score from on-chain data alone.
//!
//! The program never custodies funds and never trades. All market activity
//! (seeding, LP, swaps, settlement) runs on the pm-AMM program
//! GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y via its SDK.
//!
//! Program ID G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU was generated
//! locally on 2026-11-20 (keypair in target/deploy/, gitignored).
//! The program is NOT deployed anywhere; deploy is a later, separate step.

use anchor_lang::prelude::*;

declare_id!("G4Gib3N2vGVR4JaGjCGyvwHidz1EF3hjdztQYHZ17VgU");

/// PDA seed for the one PredictionRecord per pm-AMM market.
pub const PREDICTION_SEED: &[u8] = b"prediction";

/// Maximum accepted model probability, in basis points (100.00%).
pub const MAX_PROB_BPS: u16 = 10_000;

/// Maximum byte length of the stored model version string.
pub const MAX_MODEL_VERSION_LEN: usize = 32;

/// Brier score for one prediction, scaled by 10^8 (so the value is exact in
/// integer arithmetic): brier = (p - o)^2 with p in [0, 1] and o in {0, 1}.
/// With p expressed in bps, (prob_bps - outcome_bps)^2 / 10^8, so the
/// returned integer is simply diff_bps^2. Range: 0 (perfect) to 10^8 (1.0).
pub fn compute_brier_e8(prob_bps: u16, outcome_yes: bool) -> u64 {
    let outcome_bps: i64 = if outcome_yes { MAX_PROB_BPS as i64 } else { 0 };
    let diff = (prob_bps as i64 - outcome_bps).unsigned_abs();
    diff * diff
}

/// Validate a model probability expressed in basis points.
pub fn validate_prob_bps(prob_bps: u16) -> Result<()> {
    require!(
        prob_bps <= MAX_PROB_BPS,
        ForecastError::InvalidProbability
    );
    Ok(())
}

/// Pure state-transition guard for `attest_resolution`, factored out of the
/// instruction handler so the transition rules are unit-testable natively:
/// - the record must not already be resolved (attestation happens once);
/// - only the forecaster who committed the prediction may attest it;
/// - attestation must be strictly after the commit timestamp (a resolution
///   cannot be known at or before the moment the prediction was committed).
pub fn ensure_attestable(
    resolved: bool,
    forecaster: &Pubkey,
    attester: &Pubkey,
    now: i64,
    committed_at: i64,
) -> Result<()> {
    require!(!resolved, ForecastError::AlreadyResolved);
    require!(
        forecaster == attester,
        ForecastError::UnauthorizedAttester
    );
    require!(now > committed_at, ForecastError::AttestationTooEarly);
    Ok(())
}

#[program]
pub mod forecast_registry {
    use super::*;

    /// Commit a prediction for a pm-AMM market before trading opens.
    ///
    /// `prediction_hash` = hash(market_pubkey || model_prob_bps || model_version || issued_at)
    /// The full prediction payload is stored alongside the hash so the
    /// commitment is verifiable without trusting an off-chain database.
    /// One record exists per market: the PDA is derived from the market, so
    /// a second commit for the same market fails (account already in use) —
    /// predictions can never be re-committed or edited.
    pub fn commit_prediction(
        ctx: Context<CommitPrediction>,
        market: Pubkey,
        prediction_hash: [u8; 32],
        model_prob_bps: u16,
        model_version: String,
        strike: i64,
    ) -> Result<()> {
        validate_prob_bps(model_prob_bps)?;
        require!(
            model_version.len() <= MAX_MODEL_VERSION_LEN,
            ForecastError::ModelVersionTooLong
        );

        let clock = Clock::get()?;
        let record = &mut ctx.accounts.prediction;
        record.market = market;
        record.forecaster = ctx.accounts.keeper.key();
        record.prediction_hash = prediction_hash;
        record.model_prob_bps = model_prob_bps;
        record.model_version = model_version;
        record.strike = strike;
        record.committed_at = clock.unix_timestamp;
        record.resolved = false;
        record.outcome_yes = false;
        record.pyth_price_account = Pubkey::default();
        record.observed_price = 0;
        record.observed_slot = 0;
        record.attested_at = 0;
        record.brier_score_e8 = 0;
        record.bump = ctx.bumps.prediction;

        emit!(PredictionCommitted {
            market,
            forecaster: record.forecaster,
            prediction_hash,
            model_prob_bps,
            strike,
            committed_at: record.committed_at,
        });
        Ok(())
    }

    /// Attest the resolution of a previously committed prediction.
    ///
    /// `outcome_yes` is derived off-chain from the Pyth feed at expiry and
    /// posted here by the forecaster; the attestation records the Pyth price
    /// account, observed price and slot used so the derivation is auditable
    /// (docs/ARCHITECTURE.md §4). The Brier score contribution is computed
    /// in-program from the committed probability and the attested outcome.
    pub fn attest_resolution(
        ctx: Context<AttestResolution>,
        outcome_yes: bool,
        pyth_price_account: Pubkey,
        observed_price: i64,
        observed_slot: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let record = &mut ctx.accounts.prediction;
        ensure_attestable(
            record.resolved,
            &record.forecaster,
            &ctx.accounts.keeper.key(),
            clock.unix_timestamp,
            record.committed_at,
        )?;

        record.resolved = true;
        record.outcome_yes = outcome_yes;
        record.pyth_price_account = pyth_price_account;
        record.observed_price = observed_price;
        record.observed_slot = observed_slot;
        record.attested_at = clock.unix_timestamp;
        record.brier_score_e8 = compute_brier_e8(record.model_prob_bps, outcome_yes);

        emit!(ResolutionAttested {
            market: record.market,
            outcome_yes,
            observed_price,
            observed_slot,
            brier_score_e8: record.brier_score_e8,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(market: Pubkey)]
pub struct CommitPrediction<'info> {
    #[account(
        init,
        payer = keeper,
        space = 8 + PredictionRecord::INIT_SPACE,
        seeds = [PREDICTION_SEED, market.as_ref()],
        bump
    )]
    pub prediction: Account<'info, PredictionRecord>,
    #[account(mut)]
    pub keeper: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AttestResolution<'info> {
    #[account(
        mut,
        seeds = [PREDICTION_SEED, prediction.market.as_ref()],
        bump = prediction.bump
    )]
    pub prediction: Account<'info, PredictionRecord>,
    pub keeper: Signer<'info>,
}

/// On-chain record for one committed prediction. One PDA per pm-AMM market,
/// derived with seeds [b"prediction", market].
#[account]
#[derive(InitSpace)]
pub struct PredictionRecord {
    /// The pm-AMM market this prediction is about.
    pub market: Pubkey,
    /// The forecaster authority that committed the prediction; the only
    /// signer allowed to attest its resolution.
    pub forecaster: Pubkey,
    /// hash(market || model_prob_bps || model_version || issued_at).
    pub prediction_hash: [u8; 32],
    /// Model probability for YES, in basis points (0..=10_000).
    pub model_prob_bps: u16,
    /// Model version tag, e.g. "kernel-lr-v1".
    #[max_len(32)]
    pub model_version: String,
    /// Strike / threshold of the market question, in the same raw units as
    /// `observed_price` (Pyth-style integer price): YES wins iff the observed
    /// price at expiry is above the strike (docs/ARCHITECTURE.md §4).
    pub strike: i64,
    /// Unix timestamp of the commit.
    pub committed_at: i64,
    /// Whether a resolution has been attested.
    pub resolved: bool,
    /// The attested outcome (meaningful only once `resolved` is true).
    pub outcome_yes: bool,
    /// Pyth price account the outcome was derived from.
    pub pyth_price_account: Pubkey,
    /// Price observed at expiry, raw Pyth-style integer units.
    pub observed_price: i64,
    /// Slot at which the price was observed.
    pub observed_slot: u64,
    /// Unix timestamp of the attestation.
    pub attested_at: i64,
    /// Brier score contribution computed in-program at attestation time,
    /// scaled by 10^8 (see `compute_brier_e8`). 0 until resolved.
    pub brier_score_e8: u64,
    /// PDA bump.
    pub bump: u8,
}

#[event]
pub struct PredictionCommitted {
    pub market: Pubkey,
    pub forecaster: Pubkey,
    pub prediction_hash: [u8; 32],
    pub model_prob_bps: u16,
    pub strike: i64,
    pub committed_at: i64,
}

#[event]
pub struct ResolutionAttested {
    pub market: Pubkey,
    pub outcome_yes: bool,
    pub observed_price: i64,
    pub observed_slot: u64,
    pub brier_score_e8: u64,
}

#[error_code]
pub enum ForecastError {
    #[msg("Model probability must be within 0..=10000 bps")]
    InvalidProbability,
    #[msg("Model version string exceeds the maximum stored length")]
    ModelVersionTooLong,
    #[msg("Prediction has already been resolved")]
    AlreadyResolved,
    #[msg("Only the forecaster who committed the prediction may attest its resolution")]
    UnauthorizedAttester,
    #[msg("Resolution cannot be attested at or before the commit timestamp")]
    AttestationTooEarly,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Brier math ----

    #[test]
    fn brier_model_seed_yes() {
        // The 62% FairOdds seed, outcome YES: (0.62 - 1)^2 = 0.1444.
        assert_eq!(compute_brier_e8(6_200, true), 14_440_000);
    }

    #[test]
    fn brier_model_seed_no() {
        // (0.62 - 0)^2 = 0.3844.
        assert_eq!(compute_brier_e8(6_200, false), 38_440_000);
    }

    #[test]
    fn brier_flat_baseline_is_quarter() {
        // The honest-baseline comparison from ARCHITECTURE.md §5: a flat 50%
        // forecast scores 0.25 on every resolved market.
        assert_eq!(compute_brier_e8(5_000, true), 25_000_000);
        assert_eq!(compute_brier_e8(5_000, false), 25_000_000);
    }

    #[test]
    fn brier_extremes() {
        assert_eq!(compute_brier_e8(10_000, true), 0); // certain + right
        assert_eq!(compute_brier_e8(0, false), 0); // certain + right
        assert_eq!(compute_brier_e8(10_000, false), 100_000_000); // certain + wrong = 1.0
        assert_eq!(compute_brier_e8(0, true), 100_000_000);
    }

    #[test]
    fn brier_off_by_one_bps() {
        // 0.01% probability, outcome YES: (0.9999)^2 = 0.99980001.
        assert_eq!(compute_brier_e8(1, true), 99_980_001);
        // 99.99% probability, outcome NO: (0.9999)^2 as well.
        assert_eq!(compute_brier_e8(9_999, false), 99_980_001);
    }

    #[test]
    fn brier_symmetric_and_monotone_in_error() {
        // Error magnitude alone determines the score.
        for diff in [0u64, 1, 100, 3_800, 5_000, 9_999, 10_000] {
            let p = 10_000 - diff as u16;
            assert_eq!(compute_brier_e8(p, true), diff * diff);
            let p2 = diff as u16;
            assert_eq!(compute_brier_e8(p2, false), diff * diff);
        }
    }

    // ---- bps bounds ----

    #[test]
    fn prob_bps_bounds() {
        assert!(validate_prob_bps(0).is_ok());
        assert!(validate_prob_bps(1).is_ok());
        assert!(validate_prob_bps(6_200).is_ok());
        assert!(validate_prob_bps(9_999).is_ok());
        assert!(validate_prob_bps(10_000).is_ok());
        assert!(validate_prob_bps(10_001).is_err());
        assert!(validate_prob_bps(u16::MAX).is_err());
    }

    #[test]
    fn prob_bps_error_is_invalid_probability() {
        let err = validate_prob_bps(10_001).unwrap_err();
        assert!(err
            .to_string()
            .contains("Model probability must be within 0..=10000 bps"));
    }

    // ---- attestation state transitions ----

    fn keys() -> (Pubkey, Pubkey) {
        (
            Pubkey::new_from_array([11u8; 32]),
            Pubkey::new_from_array([22u8; 32]),
        )
    }

    #[test]
    fn attest_happy_path() {
        let (forecaster, _) = keys();
        assert!(ensure_attestable(false, &forecaster, &forecaster, 1_700_000_100, 1_700_000_000).is_ok());
    }

    #[test]
    fn attest_rejected_when_already_resolved() {
        let (forecaster, _) = keys();
        let err = ensure_attestable(true, &forecaster, &forecaster, 1_700_000_100, 1_700_000_000)
            .unwrap_err();
        assert!(err.to_string().contains("already been resolved"));
    }

    #[test]
    fn attest_rejected_for_wrong_authority() {
        let (forecaster, stranger) = keys();
        let err = ensure_attestable(false, &forecaster, &stranger, 1_700_000_100, 1_700_000_000)
            .unwrap_err();
        assert!(err
            .to_string()
            .contains("Only the forecaster who committed"));
    }

    #[test]
    fn attest_rejected_at_or_before_commit_time() {
        let (forecaster, _) = keys();
        // Same second as the commit: resolution cannot be known yet.
        let err = ensure_attestable(false, &forecaster, &forecaster, 1_700_000_000, 1_700_000_000)
            .unwrap_err();
        assert!(err.to_string().contains("at or before the commit timestamp"));
        // Earlier than the commit is rejected too.
        assert!(ensure_attestable(false, &forecaster, &forecaster, 1_699_999_999, 1_700_000_000).is_err());
    }

    #[test]
    fn attest_checks_resolution_before_authority() {
        // A resolved record reports AlreadyResolved even to a stranger:
        // state check precedes the authority check.
        let (forecaster, stranger) = keys();
        let err = ensure_attestable(true, &forecaster, &stranger, 1_700_000_100, 1_700_000_000)
            .unwrap_err();
        assert!(err.to_string().contains("already been resolved"));
    }
}
