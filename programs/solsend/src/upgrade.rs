//! Minimal, bincode-free readers for the BPFLoaderUpgradeable account states used by the
//! `initialize_config` front-run guard (audit M1).
//!
//! Anchor's `Program::programdata_address()` / `Account<ProgramData>` deserialize with bincode, which
//! grew the program by ~44 KB (≈0.3 SOL of extra devnet rent on every deploy). These layouts are the
//! loader's stable bincode encoding:
//!
//! ```text
//! Program     (36 bytes): tag u32 LE = 2 | programdata_address [32]
//! ProgramData (45-byte header): tag u32 LE = 3 | slot u64 | Option<Pubkey>: u8 (0|1) + [32] | ELF…
//! ```

use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;

const TAG_PROGRAM: u32 = 2;
const TAG_PROGRAM_DATA: u32 = 3;

fn tag(data: &[u8]) -> Option<u32> {
    Some(u32::from_le_bytes(data.get(0..4)?.try_into().ok()?))
}

/// `programdata_address` of an upgradeable program account; None if not an upgradeable program.
pub fn programdata_address(program: &AccountInfo<'_>) -> Option<Pubkey> {
    if *program.owner != bpf_loader_upgradeable::ID {
        return None;
    }
    let data = program.try_borrow_data().ok()?;
    if tag(&data)? != TAG_PROGRAM {
        return None;
    }
    Some(Pubkey::new_from_array(data.get(4..36)?.try_into().ok()?))
}

/// Upgrade authority recorded in a ProgramData account; None if the account is not ProgramData or
/// the program is immutable (no authority).
pub fn upgrade_authority(program_data: &AccountInfo<'_>) -> Option<Pubkey> {
    if *program_data.owner != bpf_loader_upgradeable::ID {
        return None;
    }
    let data = program_data.try_borrow_data().ok()?;
    if tag(&data)? != TAG_PROGRAM_DATA || *data.get(12)? != 1 {
        return None;
    }
    Some(Pubkey::new_from_array(data.get(13..45)?.try_into().ok()?))
}
