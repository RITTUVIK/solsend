# F8 close + revoke on devnet (lead, CP1 integration)

W1 found that revoking a **fee-payer-sponsored** Allowances delegation requires the sponsor as a writable
`receiver`. Without it, the revoke fails with Allowances `113` (notEnoughAccountKeys). The fix: `ixRevokeDelegation(owner, delegation, receiver)`,
where `receiver = readDelegation(data).payer`. Proven with `scripts/program/close-revoke-smoke.ts` (shared builders only):

| Step | Result | Signature |
|---|---|---|
| Create sponsored card (createFixedDelegation + register_card, fee payer sponsors) | ok | [YgTL42oK…](https://explorer.solana.com/tx/YgTL42oKjaneNgoqdn8k3sFKafSBGEoX9j83cGDSEUTbPtqpKAc3RE1HYKTZjUCMGyZB8SVKAWKrdvq87bEHQZ3?cluster=devnet) |
| Revoke **without** receiver (negative control) | fails `Custom(113)` | [5BBvLHB9…](https://explorer.solana.com/tx/5BBvLHB9JfFSLmCb7kB6NDg7NBTXKDWiEJWj6yZpF5E39G1jip8J4k59nPevpja2Sc6zxgH1kMcTnp8YaBrEnVCa?cluster=devnet) |
| `close_card` + revoke **with** receiver, one owner-signed tx | ok, `CardClosed` event; delegation account closed; card status CLOSED | [67PRQbxP…](https://explorer.solana.com/tx/67PRQbxPFNwbAVumsZW3aLoG2bqutaJPX9AR4ij1VJiLzWu5TeDJUe4TGcLogLcB4A9sQtPGJpLWQ8Rs86uLEJYX?cluster=devnet) |
| `settle` after close | fails `Custom(6003)` CardNotActive | [4y44UGTA…](https://explorer.solana.com/tx/4y44UGTARTkJh9qTN2B9W9mGto8PeCTax3Aa9xJ5etfZn2GRG6jzW6uTa3iixVrER68x4YxwPWAsqyCNqwN8dwfc?cluster=devnet) |

The Card account is intentionally kept after close, so late refunds still land. The delegation rent returns to the sponsor.
