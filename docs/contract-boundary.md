# BridgeProof contract boundary and threat model

## What the contract guarantees

BridgeProof guarantees only the following bounded behavior:

1. A proof claim is immutable once opened.
2. The contract, not the browser, fetches the configured external evidence during assessment.
3. Validators must agree on the complete consequential receipt and evidence fields.
4. Approval requires the configured finality and match rules.
5. The first approved proof permanently reserves its `(source_chain_id, tx_hash)`, so the same source transaction cannot authorize another proof.
6. A permit is bound to one proof, one executor, one target version, and one use.
7. Target activation and version are rechecked when permit validity is read, when consumption is attempted, when execution starts, and when execution finalizes.
8. Expired, replayed, stale, inactive-target, or wrong-caller execution fails closed.
9. The guarded executor records completion only after the permit lifecycle completes.

It does not guarantee that a bridge protocol, source chain, RPC provider, or destination action is economically safe.

## Trust boundaries

### Browser client

Untrusted. It can submit claims and display state. It cannot authorize itself, alter stored proof fields, issue permits, or finalize the guarded effect.

### Wallet

User-controlled. The app must handle rejected signatures, wrong accounts, wrong networks, dropped transactions, and reconnects.

### Source-chain RPC and explorer

External evidence. Responses may be unavailable, stale, malformed, inconsistent, or hostile. The contract must bind the endpoint set and normalize responses inside the nondeterministic flow.

### GenLayer validators

Independent interpreters of the same bounded evidence. The validator result must be structured, complete, and compared on every field that can change the stored decision.

### BridgeProof contract

Authoritative lifecycle and permit boundary. It enforces deterministic identity, ownership, expiry, nonce, target version, and executor checks.

### Guarded executor

The only example path allowed to perform the protected destination action. It must not expose a second unguarded method that bypasses BridgeProof.

## Threats and controls

| Threat | Control |
| --- | --- |
| Client claims a fake receipt | Contract fetches evidence itself |
| One source lies or is stale | Multiple configured sources and source-status checks |
| Validators agree on a label but disagree on fields | Complete structured result and exact consequential-field comparison |
| Wrong recipient or payload | Canonical normalization and field-level match |
| Insufficient confirmations | Explicit finality rule and confirmation evidence |
| Source outage | Fail closed with `source_failure` or `insufficient_evidence` |
| Target config changes during assessment | Version binding invalidates stale proofs |
| Same source transaction is claimed by multiple proofs | Permanent source-authorization index allows only the first approved proof to issue a permit |
| Approved target is later deactivated | Permit validity, consumption, execution start, and finalization all recheck `active` |
| Approved target is later updated | Permit validity, consumption, execution start, and finalization all recheck the bound target version |
| Permit replay | Proof nonce and consumed flag |
| Wrong executor consumes permit | Bound executor address check |
| Permit expires mid-flow | Expiry checked at each write boundary |
| User double-clicks | Client idempotency plus contract state checks |
| RPC result is ambiguous | Read reconciliation before any retrying write |
| UI claims success early | UI derives terminal state from finalized reads |
| Private credential exposure | No private keys or privileged signing in the frontend |

## Validator result shape

The transaction-receipt schema includes:

- proof ID;
- source chain ID;
- transaction hash;
- source sender;
- transaction recipient;
- transaction-input commitment;
- native transaction value;
- nonce;
- confirmation/finality result;
- per-source status and fingerprint;
- overall outcome;
- confidence band;
- canonical reason-code set.

Every declared item must appear exactly once. Free-form rationale is explanatory only and cannot affect the stored outcome.

## Known limitations to disclose

- External source reliability is bounded by the configured evidence endpoints.
- A source-chain reorganization after the configured finality rule is outside the first release guarantee.
- The first release verifies transaction-level receipt fields and confirms that the configured logs endpoint is available. It does not decode or verify a protocol-specific bridge-message event.
- Event-level bridge verification requires a separate target schema that binds the emitting contract, event signature/topics, log index, and decoded event data.
- The initial release will support one source-chain integration.

