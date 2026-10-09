# BridgeProof product specification

## Users

### Protocol operator

Configures a destination target, approved executor, source-chain network, evidence endpoints, and finality rule. The operator needs a defensible audit trail and a way to disable stale configuration.

### Relayer or agent

Submits a source-chain transaction-receipt claim and follows it through assessment and execution. The relayer must not be able to mark its own claim approved.

### Reviewer or observer

Opens a public proof URL and sees the claim, lifecycle, source snapshots, decision fields, and finalized transaction links without connecting a wallet.

## Core user journey

1. The user opens the public site and sees the supported network and product boundary.
2. The user connects a wallet and the app checks the expected network.
3. The user selects a configured target or sees that setup is required.
4. The user enters a source transaction hash and expected receipt fields.
5. The app validates the claim locally and shows a review summary before signing.
6. The contract stores the immutable proof claim.
7. The user starts assessment or waits for an authorized assessor.
8. GenLayer consensus fetches and normalizes the declared sources.
9. The proof detail page shows `approved`, `rejected`, `insufficient_evidence`, or `source_failure` with field-level reasons.
10. Only an approved proof exposes the executor action.
11. The executor consumes the one-use permit and finalizes the protected action.
12. The app reconciles the final state from chain reads and links every transaction.

## Product states

| State | Meaning | User action |
| --- | --- | --- |
| Disconnected | No wallet is connected | Connect wallet or browse public proofs |
| Wrong network | Wallet is connected to an unsupported network | Switch network |
| Setup required | No target configuration is available | Operator configures a target |
| Draft | Claim is being edited locally | Review and submit |
| Awaiting signature | Wallet confirmation is required | Approve or reject in wallet |
| Submitted | Proof transaction is visible but not final | Wait for reconciliation |
| Assessing | Consensus-backed assessment is running | Wait; leave and return later |
| Approved | Complete receipt match and a permit whose target is still active and unchanged | Start guarded execution |
| Rejected | A consequential field or rule failed | Inspect reasons; create a new proof if needed |
| Insufficient evidence | Sources were unavailable, incomplete, or contradictory | Correct configuration or submit a new proof |
| Expired | The proof or permit window ended | Create a new proof |
| Consuming | Executor has queued permit consumption | Wait for internal completion |
| Finalized | Guarded action completed | Inspect receipt and share proof URL |
| Unknown | Client cannot reconcile a recent write | Retry reads; never repeat the write blindly |

## Claim fields

The first integration must define a fixed schema. The intended minimum is:

- source chain ID;
- source transaction hash;
- source block or confirmation evidence;
- expected source sender;
- expected transaction recipient;
- transaction-input hash;
- expected native transaction value;
- source transaction nonce;
- destination target ID;
- finality requirement;
- proof expiry.

Fields may not be optional merely to make an example pass. If the source protocol does not expose a field, that limitation must be recorded in the integration boundary and reflected in the contract decision.

The source transaction hash is also a global authorization key within its source chain. Multiple pending claims may exist, but once one claim is approved, no other proof for the same `(source_chain_id, tx_hash)` can receive a permit.

## Receipt scope

The first integration proves a transaction receipt, not a bridge protocol event. It checks transaction identity, successful status, sender, recipient, native value, input commitment, nonce, confirmations, and availability of the configured logs response. It does not interpret an event as a deposit, burn, message dispatch, or bridge completion. Event-level integrations must define and enforce their own emitting-contract and event-data schema.

## Public proof page

Every proof gets a stable public URL containing:

- proof ID and network;
- current lifecycle state;
- source transaction and explorer link;
- normalized field comparison;
- source status and content fingerprints;
- consensus decision and confidence band;
- permit and executor transaction links;
- timestamps;
- explicit limitations and stale-data indicators.

The public page must never imply that a pending or rejected proof completed an action.

## UX principles

- Make the next action obvious without hiding the evidence.
- Keep the claim summary visible while the user signs.
- Show long-running consensus as a tracked process, not a frozen button.
- Explain failure in human terms and include a technical error code for support.
- Treat wallet/network state as first-class product state.
- Avoid generic crypto decoration; visual hierarchy should support auditability and confidence.

