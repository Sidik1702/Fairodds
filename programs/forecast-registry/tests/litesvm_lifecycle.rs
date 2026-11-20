//! LiteSVM integration tests for ForecastRegistry.
//!
//! The sandbox blocks UDP, so no local validator can run (PLAN.md §4);
//! LiteSVM executes the compiled program in-process instead. These tests
//! load the real SBF artifact (target/deploy/forecast_registry.so — build
//! it first with `cargo build-sbf`) and drive the full lifecycle:
//! commit -> (rejections) -> attest -> stored record + in-program Brier.
//!
//! Run: cargo test -p forecast-registry --test litesvm_lifecycle

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use forecast_registry::PredictionRecord;
use litesvm::LiteSVM;
use solana_sdk::{
    clock::Clock,
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::{Transaction, TransactionError},
    instruction::InstructionError,
};

const PROGRAM_SO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/deploy/forecast_registry.so"
);

fn setup() -> (LiteSVM, Keypair) {
    let bytes = std::fs::read(PROGRAM_SO)
        .expect("program .so missing — run `cargo build-sbf` first");
    let mut svm = LiteSVM::new();
    svm.add_program(forecast_registry::ID, &bytes)
        .expect("loading the program into LiteSVM failed");
    // LiteSVM's default Clock starts at unix_timestamp 0; seed it with a
    // realistic time so commit timestamps are meaningful (on a real cluster
    // the clock is always current).
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = 1_700_000_000;
    svm.set_sysvar(&clock);
    let forecaster = Keypair::new();
    svm.airdrop(&forecaster.pubkey(), 10_000_000_000)
        .expect("airdrop failed");
    (svm, forecaster)
}

fn send_ix(
    svm: &mut LiteSVM,
    ix: Instruction,
    payer: &Keypair,
    signers: &[&Keypair],
) -> Result<(), TransactionError> {
    let mut tx = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
    tx.sign(signers, svm.latest_blockhash());
    svm.send_transaction(tx).map(|_| ()).map_err(|e| e.err)
}

fn commit_ix(
    market: Pubkey,
    pda: Pubkey,
    keeper: Pubkey,
    prob_bps: u16,
) -> Instruction {
    let accounts = forecast_registry::accounts::CommitPrediction {
        prediction: pda,
        keeper,
        system_program: solana_sdk::system_program::ID,
    };
    let data = forecast_registry::instruction::CommitPrediction {
        market,
        prediction_hash: [7u8; 32],
        model_prob_bps: prob_bps,
        model_version: "kernel-lr-v1".to_string(),
        strike: 150_000_000,
    };
    Instruction {
        program_id: forecast_registry::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

fn attest_ix(pda: Pubkey, keeper: Pubkey, outcome_yes: bool) -> Instruction {
    let accounts = forecast_registry::accounts::AttestResolution {
        prediction: pda,
        keeper,
    };
    let data = forecast_registry::instruction::AttestResolution {
        outcome_yes,
        pyth_price_account: Pubkey::new_unique(),
        observed_price: 151_250_000,
        observed_slot: 424_242,
    };
    Instruction {
        program_id: forecast_registry::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

fn read_record(svm: &LiteSVM, pda: &Pubkey) -> PredictionRecord {
    let account = svm.get_account(pda).expect("record account missing");
    PredictionRecord::try_deserialize(&mut &account.data[..])
        .expect("record does not deserialize")
}

fn custom_err(err: &TransactionError) -> Option<u32> {
    match err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => Some(*code),
        _ => None,
    }
}

#[test]
fn commit_attest_lifecycle_with_in_program_brier() {
    let (mut svm, forecaster) = setup();
    let market = Pubkey::new_unique();
    let (pda, bump) = Pubkey::find_program_address(
        &[forecast_registry::PREDICTION_SEED, market.as_ref()],
        &forecast_registry::ID,
    );

    // --- commit ---
    let ix = commit_ix(market, pda, forecaster.pubkey(), 6_200);
    send_ix(&mut svm, ix, &forecaster, &[&forecaster])
        .expect("commit should succeed");

    let record = read_record(&svm, &pda);
    assert_eq!(record.market, market);
    assert_eq!(record.forecaster, forecaster.pubkey());
    assert_eq!(record.prediction_hash, [7u8; 32]);
    assert_eq!(record.model_prob_bps, 6_200);
    assert_eq!(record.model_version, "kernel-lr-v1");
    assert_eq!(record.strike, 150_000_000);
    assert!(!record.resolved);
    assert_eq!(record.brier_score_e8, 0);
    assert_eq!(record.bump, bump);
    assert!(record.committed_at > 0, "commit timestamp must be recorded");

    // --- re-commit to the same market must be rejected ---
    let ix = commit_ix(market, pda, forecaster.pubkey(), 5_000);
    let res = send_ix(&mut svm, ix, &forecaster, &[&forecaster]);
    assert!(res.is_err(), "second commit for the same market must fail");
    // The original record is untouched.
    let record = read_record(&svm, &pda);
    assert_eq!(record.model_prob_bps, 6_200);

    // --- attest by a stranger must be rejected (6003 UnauthorizedAttester) ---
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let ix = attest_ix(pda, stranger.pubkey(), true);
    let err = send_ix(&mut svm, ix, &stranger, &[&stranger])
        .expect_err("attest by non-forecaster must fail");
    assert_eq!(custom_err(&err), Some(6003), "expected UnauthorizedAttester, got {err:?}");
    assert!(!read_record(&svm, &pda).resolved);

    // --- move time forward so the resolution is knowable ---
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = record.committed_at + 3_600;
    svm.set_sysvar(&clock);

    // --- attest by the forecaster: outcome YES against a 62% forecast ---
    let ix = attest_ix(pda, forecaster.pubkey(), true);
    send_ix(&mut svm, ix, &forecaster, &[&forecaster])
        .expect("attest by forecaster should succeed");

    let record = read_record(&svm, &pda);
    assert!(record.resolved);
    assert!(record.outcome_yes);
    assert_eq!(record.observed_price, 151_250_000);
    assert_eq!(record.observed_slot, 424_242);
    assert_eq!(record.attested_at, record.committed_at + 3_600);
    // Brier computed in-program: (0.62 - 1)^2 = 0.1444 -> 14_440_000 (x1e8).
    assert_eq!(record.brier_score_e8, 14_440_000);

    // --- second attestation must be rejected (6002 AlreadyResolved) ---
    let ix = attest_ix(pda, forecaster.pubkey(), false);
    let err = send_ix(&mut svm, ix, &forecaster, &[&forecaster])
        .expect_err("second attestation must fail");
    assert_eq!(custom_err(&err), Some(6002), "expected AlreadyResolved, got {err:?}");
    // Record still carries the first attestation.
    let record = read_record(&svm, &pda);
    assert!(record.outcome_yes);
    assert_eq!(record.brier_score_e8, 14_440_000);
}

#[test]
fn commit_rejects_probability_above_10000_bps() {
    let (mut svm, forecaster) = setup();
    let market = Pubkey::new_unique();
    let (pda, _) = Pubkey::find_program_address(
        &[forecast_registry::PREDICTION_SEED, market.as_ref()],
        &forecast_registry::ID,
    );
    let ix = commit_ix(market, pda, forecaster.pubkey(), 10_001);
    let err = send_ix(&mut svm, ix, &forecaster, &[&forecaster])
        .expect_err("prob above 10000 bps must fail");
    assert_eq!(custom_err(&err), Some(6000), "expected InvalidProbability, got {err:?}");
    assert!(svm.get_account(&pda).is_none(), "no record may persist");
}

#[test]
fn attest_before_any_commit_fails() {
    let (mut svm, forecaster) = setup();
    let market = Pubkey::new_unique();
    let (pda, _) = Pubkey::find_program_address(
        &[forecast_registry::PREDICTION_SEED, market.as_ref()],
        &forecast_registry::ID,
    );
    // The PDA account does not exist; Anchor must reject the instruction.
    let ix = attest_ix(pda, forecaster.pubkey(), true);
    let res = send_ix(&mut svm, ix, &forecaster, &[&forecaster]);
    assert!(res.is_err(), "attest without a prior commit must fail");
}
