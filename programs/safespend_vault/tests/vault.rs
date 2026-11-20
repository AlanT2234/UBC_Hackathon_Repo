//! LiteSVM tests for `safespend_vault`. Each test builds Dorothy's vault (3 guardians, the third a
//! professional; $100 per payment, $300/week, 2 approvals at $500+), then drives the program
//! directly with the clock under test control.

use {
    anchor_lang::{
        error::{ErrorCode as AnchorError, ERROR_CODE_OFFSET},
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{associated_token::get_associated_token_address, token::TokenAccount},
    litesvm::{types::FailedTransactionMetadata, LiteSVM},
    litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo},
    safespend_vault::{
        accounts as acc, error::SafeSpendError, instruction as ix, InitVaultParams,
        PendingTransfer, Vault, ESCROW_SEED, PAYEE_SEED, PENDING_SEED, VAULT_SEED,
    },
    solana_clock::Clock,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const USD: u64 = 1_000_000;
const T0: i64 = 1_763_500_000;
const HOUR: i64 = 60 * 60;
const DAY: i64 = 24 * HOUR;
const HOLD_SECONDS: i64 = 30 * 60;

type TxResult = Result<(), FailedTransactionMetadata>;

#[derive(Clone, Copy)]
enum Who {
    Senior,
    Agent,
    G0,
    G1,
    /// The professional guardian (Maple Credit Union's fraud desk in the demo).
    Pro,
    Stranger,
}

struct Env {
    svm: LiteSVM,
    payer: Keypair,
    senior: Keypair,
    agent: Keypair,
    guardians: [Keypair; 3],
    stranger: Keypair,
    mint: Pubkey,
    vault: Pubkey,
    vault_token: Pubkey,
    /// Allowlisted at onboarding, so active immediately.
    maria: Pubkey,
}

fn send(svm: &mut LiteSVM, payer: &Keypair, ixs: &[Instruction], signers: &[&Keypair]) -> TxResult {
    let mut all = vec![payer];
    all.extend(signers.iter().copied().filter(|k| k.pubkey() != payer.pubkey()));
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &all).unwrap();
    let result = svm.send_transaction(tx).map(|_| ());
    // Identical retries (e.g. a second approve) must reach the program, not the dedupe cache.
    svm.expire_blockhash();
    result
}

fn ixn(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    Instruction::new_with_bytes(safespend_vault::ID, &data.data(), accounts.to_account_metas(None))
}

fn err(e: SafeSpendError) -> u32 {
    ERROR_CODE_OFFSET + e as u32
}

#[track_caller]
fn assert_code(result: TxResult, code: u32) {
    let e = result.expect_err("transaction should have failed");
    let got = format!("{:?}", e.err);
    assert!(
        got.contains(&format!("Custom({code})")),
        "expected Custom({code}), got {got}\n{:#?}",
        e.meta.logs
    );
}

fn default_params(guardians: &[Keypair; 3], agent: &Keypair) -> InitVaultParams {
    InitVaultParams {
        guardians: guardians.iter().map(|g| g.pubkey()).collect(),
        professional_mask: 0b100,
        big_amount_threshold: 500 * USD,
        per_payment_limit: 100 * USD,
        weekly_cap: 300 * USD,
        hold_seconds: HOLD_SECONDS,
        unfreeze_delay_seconds: 48 * HOUR,
        change_delay_seconds: DAY,
        agent_session_key: agent.pubkey(),
    }
}

impl Env {
    fn new() -> Self {
        Self::with(|_| {})
    }

    /// Dorothy's vault with `tweak` applied to the init params, funded with $1,200.
    fn with(tweak: impl FnOnce(&mut InitVaultParams)) -> Self {
        let (mut env, result) = Self::init(tweak);
        result.expect("init_vault");
        let maria = env.wallet();
        env.add_payee(Who::Senior, maria).expect("seed payee");
        env.complete_setup().expect("complete_setup");
        env.maria = maria;
        MintTo::new(&mut env.svm, &env.payer, &env.mint, &env.vault_token, 1_200 * USD)
            .send()
            .unwrap();
        env
    }

    fn init(tweak: impl FnOnce(&mut InitVaultParams)) -> (Self, TxResult) {
        let mut svm = LiteSVM::new();
        let program = include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/safespend_vault.so"
        ));
        svm.add_program(safespend_vault::ID, program).unwrap();
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
        let mint = CreateMint::new(&mut svm, &payer).decimals(6).send().unwrap();

        let senior = Keypair::new();
        let agent = Keypair::new();
        let guardians = [Keypair::new(), Keypair::new(), Keypair::new()];
        let vault = Pubkey::find_program_address(
            &[VAULT_SEED, senior.pubkey().as_ref()],
            &safespend_vault::ID,
        )
        .0;
        let vault_token = get_associated_token_address(&vault, &mint);
        let mut env = Env {
            svm,
            payer,
            senior,
            agent,
            guardians,
            stranger: Keypair::new(),
            mint,
            vault,
            vault_token,
            maria: Pubkey::default(),
        };
        env.set_time(T0);

        let mut params = default_params(&env.guardians, &env.agent);
        tweak(&mut params);
        let init = ixn(
            ix::InitVault { params },
            acc::InitVault {
                payer: env.payer.pubkey(),
                senior: env.senior.pubkey(),
                vault,
                mint,
                vault_token,
                token_program: anchor_spl::token::ID,
                associated_token_program: anchor_spl::associated_token::ID,
                system_program: system_program::ID,
            },
        );
        let result = send(&mut env.svm, &env.payer, &[init], &[&env.senior]);
        (env, result)
    }

    fn key(&self, who: Who) -> &Keypair {
        match who {
            Who::Senior => &self.senior,
            Who::Agent => &self.agent,
            Who::G0 => &self.guardians[0],
            Who::G1 => &self.guardians[1],
            Who::Pro => &self.guardians[2],
            Who::Stranger => &self.stranger,
        }
    }

    fn run(&mut self, ix: Instruction, who: Who) -> TxResult {
        let signer = match who {
            Who::Senior => &self.senior,
            Who::Agent => &self.agent,
            Who::G0 => &self.guardians[0],
            Who::G1 => &self.guardians[1],
            Who::Pro => &self.guardians[2],
            Who::Stranger => &self.stranger,
        };
        send(&mut self.svm, &self.payer, &[ix], &[signer])
    }

    // --- clock and reads ---

    fn set_time(&mut self, t: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = t;
        self.svm.set_sysvar(&clock);
    }

    fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    fn warp(&mut self, seconds: i64) {
        let t = self.now() + seconds;
        self.set_time(t);
    }

    fn state(&self) -> Vault {
        let account = self.svm.get_account(&self.vault).expect("vault exists");
        Vault::try_deserialize(&mut &account.data[..]).unwrap()
    }

    fn pending(&self, hold: &Pubkey) -> Option<PendingTransfer> {
        let account = self.svm.get_account(hold).filter(|a| !a.data.is_empty())?;
        Some(PendingTransfer::try_deserialize(&mut &account.data[..]).unwrap())
    }

    fn exists(&self, address: &Pubkey) -> bool {
        self.svm
            .get_account(address)
            .is_some_and(|a| a.lamports > 0)
    }

    fn balance(&self, token_account: &Pubkey) -> u64 {
        let account = self.svm.get_account(token_account).expect("token account exists");
        TokenAccount::try_deserialize(&mut &account.data[..])
            .unwrap()
            .amount
    }

    fn vault_balance(&self) -> u64 {
        self.balance(&self.vault_token)
    }

    fn ata(&self, owner: &Pubkey) -> Pubkey {
        get_associated_token_address(owner, &self.mint)
    }

    /// A fresh recipient wallet with its USDC token account.
    fn wallet(&mut self) -> Pubkey {
        let owner = Keypair::new().pubkey();
        CreateAssociatedTokenAccount::new(&mut self.svm, &self.payer, &self.mint)
            .owner(&owner)
            .send()
            .unwrap();
        owner
    }

    fn payee_pda(&self, recipient: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[PAYEE_SEED, self.vault.as_ref(), recipient.as_ref()],
            &safespend_vault::ID,
        )
        .0
    }

    // --- instructions ---

    fn add_payee(&mut self, by: Who, recipient: Pubkey) -> TxResult {
        let ix = ixn(
            ix::AddPayee { recipient },
            acc::AddPayee {
                payer: self.payer.pubkey(),
                proposer: self.key(by).pubkey(),
                vault: self.vault,
                payee: self.payee_pda(&recipient),
                system_program: system_program::ID,
            },
        );
        self.run(ix, by)
    }

    fn remove_payee(&mut self, by: Who, recipient: Pubkey) -> TxResult {
        let ix = ixn(
            ix::RemovePayee {},
            acc::RemovePayee {
                signer: self.key(by).pubkey(),
                vault: self.vault,
                payee: self.payee_pda(&recipient),
                rent_payer: self.payer.pubkey(),
            },
        );
        self.run(ix, by)
    }

    fn complete_setup(&mut self) -> TxResult {
        let ix = ixn(
            ix::CompleteSetup {},
            acc::CompleteSetup {
                senior: self.senior.pubkey(),
                vault: self.vault,
            },
        );
        self.run(ix, Who::Senior)
    }

    fn pay_as(&mut self, by: Who, recipient: Pubkey, amount: u64) -> TxResult {
        let ix = ixn(
            ix::Pay { amount },
            acc::Pay {
                agent: self.key(by).pubkey(),
                vault: self.vault,
                payee: self.payee_pda(&recipient),
                recipient,
                mint: self.mint,
                vault_token: self.vault_token,
                recipient_token: self.ata(&recipient),
                token_program: anchor_spl::token::ID,
            },
        );
        self.run(ix, by)
    }

    fn pay(&mut self, recipient: Pubkey, amount: u64) -> TxResult {
        self.pay_as(Who::Agent, recipient, amount)
    }

    fn hold_as(&mut self, by: Who, recipient: Pubkey, amount: u64) -> Result<Pubkey, FailedTransactionMetadata> {
        let nonce = self.state().next_nonce;
        let pending = Pubkey::find_program_address(
            &[PENDING_SEED, self.vault.as_ref(), &nonce.to_le_bytes()],
            &safespend_vault::ID,
        )
        .0;
        let escrow =
            Pubkey::find_program_address(&[ESCROW_SEED, pending.as_ref()], &safespend_vault::ID).0;
        let ix = ixn(
            ix::RequestHold { amount, nonce },
            acc::RequestHold {
                payer: self.payer.pubkey(),
                agent: self.key(by).pubkey(),
                vault: self.vault,
                recipient,
                mint: self.mint,
                vault_token: self.vault_token,
                recipient_token: self.ata(&recipient),
                pending,
                escrow,
                token_program: anchor_spl::token::ID,
                system_program: system_program::ID,
            },
        );
        self.run(ix, by).map(|_| pending)
    }

    fn hold(&mut self, recipient: Pubkey, amount: u64) -> Pubkey {
        self.hold_as(Who::Agent, recipient, amount).expect("request_hold")
    }

    fn escrow(hold: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[ESCROW_SEED, hold.as_ref()], &safespend_vault::ID).0
    }

    /// `approve` with the recipient accounts overridable, to test redirect attempts.
    fn approve_to(&mut self, by: Who, hold: Pubkey, recipient: Pubkey, recipient_token: Pubkey) -> TxResult {
        let rent_receiver = self.pending(&hold).map_or(self.payer.pubkey(), |p| p.rent_receiver);
        let ix = ixn(
            ix::Approve {},
            acc::Approve {
                guardian: self.key(by).pubkey(),
                vault: self.vault,
                pending: hold,
                escrow: Self::escrow(&hold),
                recipient,
                mint: self.mint,
                recipient_token,
                rent_receiver,
                token_program: anchor_spl::token::ID,
            },
        );
        self.run(ix, by)
    }

    fn approve(&mut self, by: Who, hold: Pubkey, recipient: Pubkey) -> TxResult {
        let token = self.ata(&recipient);
        self.approve_to(by, hold, recipient, token)
    }

    fn refund_accounts(&self, hold: Pubkey) -> acc::Refund {
        acc::Refund {
            vault: self.vault,
            pending: hold,
            escrow: Self::escrow(&hold),
            vault_token: self.vault_token,
            rent_receiver: self.payer.pubkey(),
            token_program: anchor_spl::token::ID,
        }
    }

    fn reject(&mut self, by: Who, hold: Pubkey) -> TxResult {
        let ix = ixn(
            ix::Reject {},
            acc::Reject {
                signer: self.key(by).pubkey(),
                refund: self.refund_accounts(hold),
            },
        );
        self.run(ix, by)
    }

    fn expire(&mut self, hold: Pubkey) -> TxResult {
        let ix = ixn(ix::Expire {}, acc::Expire { refund: self.refund_accounts(hold) });
        send(&mut self.svm, &self.payer, &[ix], &[])
    }

    fn freeze(&mut self, by: Who) -> TxResult {
        let ix = ixn(
            ix::Freeze {},
            acc::Freeze {
                authority: self.key(by).pubkey(),
                vault: self.vault,
            },
        );
        self.run(ix, by)
    }

    fn unfreeze(&mut self, by: Who) -> TxResult {
        let ix = ixn(
            ix::Unfreeze {},
            acc::Unfreeze {
                guardian: self.key(by).pubkey(),
                vault: self.vault,
            },
        );
        self.run(ix, by)
    }

    fn request_unfreeze(&mut self, by: Who) -> TxResult {
        let ix = ixn(
            ix::RequestUnfreeze {},
            acc::RequestUnfreeze {
                senior: self.key(by).pubkey(),
                vault: self.vault,
            },
        );
        self.run(ix, by)
    }

    fn execute_unfreeze(&mut self) -> TxResult {
        let ix = ixn(ix::ExecuteUnfreeze {}, acc::ExecuteUnfreeze { vault: self.vault });
        send(&mut self.svm, &self.payer, &[ix], &[])
    }
}

// --- init ---

#[test]
fn init_sets_rules_and_rejects_bad_configs() {
    let env = Env::new();
    let v = env.state();
    assert_eq!(v.senior, env.senior.pubkey());
    assert_eq!(v.guardians.len(), 3);
    assert_eq!(v.weekly_cap, 300 * USD);
    assert!(v.setup_complete && !v.frozen);
    assert_eq!(env.vault_balance(), 1_200 * USD);

    let (_, r) = Env::init(|p| p.guardians[1] = p.guardians[0]);
    assert_code(r, err(SafeSpendError::InvalidConfig));
    let (_, r) = Env::init(|p| p.guardians.clear());
    assert_code(r, err(SafeSpendError::InvalidConfig));
    let (_, r) = Env::init(|p| p.per_payment_limit = p.weekly_cap + 1);
    assert_code(r, err(SafeSpendError::InvalidConfig));
    let (_, r) = Env::init(|p| p.professional_mask = 0b1000);
    assert_code(r, err(SafeSpendError::InvalidConfig));
    let (_, r) = Env::init(|p| p.agent_session_key = p.guardians[0]);
    assert_code(r, err(SafeSpendError::InvalidConfig));
}

// --- pay ---

#[test]
fn pay_sends_instantly_to_an_allowlisted_payee() {
    let mut env = Env::new();
    let maria = env.maria;
    env.pay(maria, 20 * USD).unwrap();
    assert_eq!(env.balance(&env.ata(&maria)), 20 * USD);
    assert_eq!(env.vault_balance(), 1_180 * USD);
    assert_eq!(env.state().spent_in_window, 20 * USD);
}

#[test]
fn pay_enforces_limits_allowlist_and_signer() {
    let mut env = Env::new();
    let maria = env.maria;
    assert_code(env.pay(maria, 0), err(SafeSpendError::InvalidAmount));
    assert_code(env.pay(maria, 101 * USD), err(SafeSpendError::OverPerPaymentLimit));

    let stranger = env.wallet();
    assert_code(env.pay(stranger, 10 * USD), AnchorError::AccountNotInitialized as u32);

    // Guardians can never initiate payments.
    assert_code(env.pay_as(Who::G0, maria, 10 * USD), err(SafeSpendError::Unauthorized));
    assert_code(env.pay_as(Who::Senior, maria, 10 * USD), err(SafeSpendError::Unauthorized));
    assert_eq!(env.vault_balance(), 1_200 * USD);
}

#[test]
fn pay_over_the_weekly_cap_fails_and_the_window_resets() {
    let mut env = Env::new();
    let maria = env.maria;
    for _ in 0..3 {
        env.pay(maria, 100 * USD).unwrap();
    }
    assert_code(env.pay(maria, 1), err(SafeSpendError::OverWeeklyCap));

    env.warp(7 * DAY - 1);
    assert_code(env.pay(maria, 1), err(SafeSpendError::OverWeeklyCap));
    env.warp(1);
    env.pay(maria, 100 * USD).unwrap();
    let v = env.state();
    assert_eq!(v.spent_in_window, 100 * USD);
    assert_eq!(v.window_start, env.now());
}

#[test]
fn pay_fails_when_the_vault_cannot_cover_it() {
    let mut env = Env::with(|p| {
        p.per_payment_limit = 2_000 * USD;
        p.weekly_cap = 5_000 * USD;
    });
    let maria = env.maria;
    assert_code(env.pay(maria, 1_201 * USD), err(SafeSpendError::InsufficientFunds));
}

// --- payees ---

#[test]
fn new_payee_is_not_usable_until_its_waiting_period_passes() {
    let mut env = Env::new();
    let plumber = env.wallet();
    assert_code(env.add_payee(Who::Stranger, plumber), err(SafeSpendError::Unauthorized));
    env.add_payee(Who::G0, plumber).unwrap();

    assert_code(env.pay(plumber, 50 * USD), err(SafeSpendError::PayeeNotAllowlisted));
    env.warp(DAY - 1);
    assert_code(env.pay(plumber, 50 * USD), err(SafeSpendError::PayeeNotAllowlisted));
    env.warp(1);
    env.pay(plumber, 50 * USD).unwrap();
    assert_eq!(env.balance(&env.ata(&plumber)), 50 * USD);
}

#[test]
fn removed_payee_can_no_longer_be_paid() {
    let mut env = Env::new();
    let maria = env.maria;
    assert_code(env.remove_payee(Who::Stranger, maria), err(SafeSpendError::Unauthorized));
    env.remove_payee(Who::G1, maria).unwrap();
    assert!(!env.exists(&env.payee_pda(&maria)));
    assert_code(env.pay(maria, 10 * USD), AnchorError::AccountNotInitialized as u32);
}

// --- holds ---

#[test]
fn approve_before_the_deadline_pays_the_recipient_and_closes_the_hold() {
    let mut env = Env::new();
    let plumber = env.wallet();
    let hold = env.hold(plumber, 400 * USD);
    let p = env.pending(&hold).unwrap();
    assert_eq!(p.recipient, plumber);
    assert_eq!(p.approvals_required, 1);
    assert_eq!(p.expires_at, T0 + HOLD_SECONDS);
    assert_eq!(env.vault_balance(), 800 * USD);
    assert_eq!(env.balance(&Env::escrow(&hold)), 400 * USD);
    assert_eq!(env.state().open_holds, 1);

    let lamports_before = env.svm.get_account(&env.payer.pubkey()).unwrap().lamports;
    env.approve(Who::G0, hold, plumber).unwrap();
    assert_eq!(env.balance(&env.ata(&plumber)), 400 * USD);
    assert!(!env.exists(&hold));
    assert!(!env.exists(&Env::escrow(&hold)));
    assert_eq!(env.state().open_holds, 0);
    // Both rents come back to the fee payer, which is more than the 5000-lamport fee.
    let lamports_after = env.svm.get_account(&env.payer.pubkey()).unwrap().lamports;
    assert!(lamports_after > lamports_before);

    // A second approve has nothing to act on.
    assert!(env.approve(Who::G1, hold, plumber).is_err());
    // Holds don't count toward the weekly cap.
    assert_eq!(env.state().spent_in_window, 0);
}

#[test]
fn big_amount_needs_two_distinct_guardians() {
    let mut env = Env::new();
    let roofer = env.wallet();
    let hold = env.hold(roofer, 600 * USD);
    assert_eq!(env.pending(&hold).unwrap().approvals_required, 2);

    env.approve(Who::G0, hold, roofer).unwrap();
    assert_eq!(env.pending(&hold).unwrap().approvals, 0b001);
    assert_eq!(env.balance(&env.ata(&roofer)), 0);
    assert_code(env.approve(Who::G0, hold, roofer), err(SafeSpendError::AlreadyApproved));

    env.approve(Who::Pro, hold, roofer).unwrap();
    assert_eq!(env.balance(&env.ata(&roofer)), 600 * USD);
    assert!(!env.exists(&hold));
}

#[test]
fn big_amount_with_one_guardian_needs_one_approval() {
    let mut env = Env::with(|p| {
        p.guardians.truncate(1);
        p.professional_mask = 0;
    });
    let roofer = env.wallet();
    let hold = env.hold(roofer, 600 * USD);
    assert_eq!(env.pending(&hold).unwrap().approvals_required, 1);
    env.approve(Who::G0, hold, roofer).unwrap();
    assert_eq!(env.balance(&env.ata(&roofer)), 600 * USD);
}

#[test]
fn deadline_blocks_approval_and_opens_expiry() {
    let mut env = Env::new();
    let plumber = env.wallet();
    let hold = env.hold(plumber, 400 * USD);

    assert_code(env.expire(hold), err(SafeSpendError::HoldNotExpired));
    env.warp(HOLD_SECONDS);
    assert_code(env.approve(Who::G0, hold, plumber), err(SafeSpendError::HoldExpired));

    env.expire(hold).unwrap();
    assert_eq!(env.vault_balance(), 1_200 * USD);
    assert_eq!(env.balance(&env.ata(&plumber)), 0);
    assert!(!env.exists(&hold));
    assert_eq!(env.state().open_holds, 0);
}

#[test]
fn only_guardians_approve_and_only_senior_or_guardians_reject() {
    let mut env = Env::new();
    let plumber = env.wallet();
    let hold = env.hold(plumber, 400 * USD);

    assert_code(env.approve(Who::Stranger, hold, plumber), err(SafeSpendError::NotGuardian));
    assert_code(env.approve(Who::Senior, hold, plumber), err(SafeSpendError::NotGuardian));
    assert_code(env.approve(Who::Agent, hold, plumber), err(SafeSpendError::NotGuardian));
    assert_code(env.reject(Who::Stranger, hold), err(SafeSpendError::Unauthorized));
    assert_code(env.reject(Who::Agent, hold), err(SafeSpendError::Unauthorized));

    env.reject(Who::Senior, hold).unwrap();
    assert_eq!(env.vault_balance(), 1_200 * USD);
    assert!(!env.exists(&hold));
}

#[test]
fn approval_cannot_redirect_funds() {
    let mut env = Env::new();
    let plumber = env.wallet();
    let attacker = env.wallet();
    let hold = env.hold(plumber, 400 * USD);

    let attacker_token = env.ata(&attacker);
    assert_code(
        env.approve_to(Who::G0, hold, attacker, attacker_token),
        AnchorError::ConstraintHasOne as u32,
    );
    assert!(env.approve_to(Who::G0, hold, plumber, attacker_token).is_err());
    assert_eq!(env.balance(&attacker_token), 0);
    assert_eq!(env.balance(&Env::escrow(&hold)), 400 * USD);

    env.approve(Who::G0, hold, plumber).unwrap();
    assert_eq!(env.balance(&env.ata(&plumber)), 400 * USD);
}

#[test]
fn hold_rules_signer_nonce_balance_and_spam_cap() {
    let mut env = Env::new();
    let plumber = env.wallet();
    assert_code(env.hold_as(Who::G0, plumber, 10 * USD).map(|_| ()), err(SafeSpendError::Unauthorized));
    assert_code(env.hold_as(Who::Agent, plumber, 0).map(|_| ()), err(SafeSpendError::InvalidAmount));
    assert_code(
        env.hold_as(Who::Agent, plumber, 1_201 * USD).map(|_| ()),
        err(SafeSpendError::InsufficientFunds),
    );

    for _ in 0..5 {
        env.hold(plumber, 10 * USD);
    }
    assert_code(env.hold_as(Who::Agent, plumber, 10 * USD).map(|_| ()), err(SafeSpendError::TooManyHolds));
    assert_eq!(env.state().next_nonce, 5);
    assert_eq!(env.vault_balance(), 1_150 * USD);
}

// --- freeze ---

#[test]
fn frozen_vault_blocks_payments_holds_and_approvals_but_allows_refunds() {
    let mut env = Env::new();
    let maria = env.maria;
    let plumber = env.wallet();
    let a = env.hold(plumber, 400 * USD);
    let b = env.hold(plumber, 50 * USD);

    env.freeze(Who::G1).unwrap();
    assert!(env.state().frozen);
    assert_code(env.pay(maria, 10 * USD), err(SafeSpendError::Frozen));
    assert_code(env.hold_as(Who::Agent, plumber, 10 * USD).map(|_| ()), err(SafeSpendError::Frozen));
    assert_code(env.approve(Who::G0, a, plumber), err(SafeSpendError::Frozen));

    env.reject(Who::G0, a).unwrap();
    env.warp(HOLD_SECONDS);
    env.expire(b).unwrap();
    assert_eq!(env.vault_balance(), 1_200 * USD);
}

#[test]
fn any_single_guardian_or_the_sentinel_can_freeze() {
    for who in [Who::G0, Who::G1, Who::Pro, Who::Agent] {
        let mut env = Env::new();
        env.freeze(who).unwrap();
        assert!(env.state().frozen);
        assert_code(env.freeze(Who::G0), err(SafeSpendError::AlreadyFrozen));
    }
    let mut env = Env::new();
    assert_code(env.freeze(Who::Stranger), err(SafeSpendError::NotGuardian));
    assert_code(env.freeze(Who::Senior), err(SafeSpendError::NotGuardian));
}

#[test]
fn guardian_unfreezes_instantly() {
    let mut env = Env::new();
    let maria = env.maria;
    assert_code(env.unfreeze(Who::G0), err(SafeSpendError::NotFrozen));
    env.freeze(Who::Agent).unwrap();
    assert_code(env.unfreeze(Who::Stranger), err(SafeSpendError::NotGuardian));
    assert_code(env.unfreeze(Who::Senior), err(SafeSpendError::NotGuardian));
    env.unfreeze(Who::G1).unwrap();
    assert!(!env.state().frozen);
    env.pay(maria, 10 * USD).unwrap();
}

#[test]
fn senior_unfreeze_works_only_after_the_delay() {
    let mut env = Env::new();
    let maria = env.maria;
    assert_code(env.request_unfreeze(Who::Senior), err(SafeSpendError::NotFrozen));
    env.freeze(Who::G0).unwrap();
    assert_code(env.execute_unfreeze(), err(SafeSpendError::NoUnfreezeRequested));
    assert_code(env.request_unfreeze(Who::G0), err(SafeSpendError::Unauthorized));

    env.request_unfreeze(Who::Senior).unwrap();
    assert_eq!(env.state().unfreeze_requested_at, Some(T0));
    assert_code(env.request_unfreeze(Who::Senior), err(SafeSpendError::UnfreezeAlreadyRequested));

    env.warp(48 * HOUR - 1);
    assert_code(env.execute_unfreeze(), err(SafeSpendError::UnfreezeDelayNotElapsed));
    assert_code(env.pay(maria, 10 * USD), err(SafeSpendError::Frozen));
    env.warp(1);
    env.execute_unfreeze().unwrap();

    let v = env.state();
    assert!(!v.frozen);
    assert_eq!(v.self_unfrozen_at, Some(T0 + 48 * HOUR));
    assert_eq!(v.unfreeze_requested_at, None);
    env.pay(maria, 10 * USD).unwrap();
}

fn self_unfrozen_env() -> Env {
    let mut env = Env::new();
    env.freeze(Who::G0).unwrap();
    env.request_unfreeze(Who::Senior).unwrap();
    env.warp(48 * HOUR);
    env.execute_unfreeze().unwrap();
    env
}

#[test]
fn after_a_self_unfreeze_one_family_guardian_cannot_refreeze() {
    let mut env = self_unfrozen_env();
    env.freeze(Who::G0).unwrap();
    let v = env.state();
    assert!(!v.frozen);
    assert_eq!(v.freeze_votes, 0b001);

    // Repeating the same vote doesn't add up to a quorum.
    env.freeze(Who::G0).unwrap();
    assert!(!env.state().frozen);

    env.freeze(Who::G1).unwrap();
    let v = env.state();
    assert!(v.frozen);
    assert_eq!(v.freeze_votes, 0);
}

#[test]
fn after_a_self_unfreeze_a_professional_or_the_sentinel_refreezes_alone() {
    let mut env = self_unfrozen_env();
    env.freeze(Who::Pro).unwrap();
    assert!(env.state().frozen);

    let mut env = self_unfrozen_env();
    env.freeze(Who::Agent).unwrap();
    assert!(env.state().frozen);
}

#[test]
fn guardian_unfreeze_restores_single_guardian_freezing() {
    let mut env = self_unfrozen_env();
    env.freeze(Who::Agent).unwrap();
    env.unfreeze(Who::G1).unwrap();
    let v = env.state();
    assert_eq!(v.self_unfrozen_at, None);
    env.freeze(Who::G0).unwrap();
    assert!(env.state().frozen);
}
