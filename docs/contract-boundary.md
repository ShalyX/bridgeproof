# BridgeProof contract boundary and threat model

## What the contract guarantees

BridgeProof guarantees only the following bounded behavior:

1. A proof claim is immutable once opened.
2. The contract, not the browser, fetches the configured external evidence during assessment.
3. Validators must agree on the complete consequential receipt and evidence fields.
4. Approval requires the configured finality and match rules.
5. A permit is bound to one proof, one executor, one target version, and one use.
6. Expired, replayed, stale, or wrong-caller execution fails closed.
7. The guarded executor records completion only after the permit lifecycle completes.

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
| Permit replay | Proof nonce and consumed flag |
| Wrong executor consumes permit | Bound executor address check |
| Permit expires mid-flow | Expiry checked at each write boundary |
| User double-clicks | Client idempotency plus contract state checks |
| RPC result is ambiguous | Read reconciliation before any retrying write |
| UI claims success early | UI derives terminal state from finalized reads |
| Private credential exposure | No private keys or privileged signing in the frontend |

## Validator result shape

The exact schema will be frozen before implementation. It must include at least:

- proof ID;
- source chain ID;
- transaction hash;
- message ID;
- source sender;
- destination recipient;
- payload commitment;
- amount and asset;
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
- The product verifies the configured message shape; it does not audit the source protocol's full implementation.
- The initial release will support one source-chain integration.

