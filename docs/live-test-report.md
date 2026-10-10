# BridgeProof live test report

Updated: 2026-10-10

## Security correction status

The October 7 deployment below is retained as historical evidence for the
original end-to-end flow. It does **not** contain the October 9 hardening and
must not be treated as evidence for the corrected replay and target-mutation
invariants.

The corrected contracts now:

- reserve `(source_chain_id, tx_hash)` when the first proof is approved;
- reject a later proof for the same source transaction with
  `SOURCE_TRANSACTION_REPLAY`, including when both proofs were opened before
  either assessment;
- make `is_permit_valid` fail when the target is inactive or its version no
  longer matches the approved proof;
- enforce target activation and version again at permit consumption, executor
  start, and executor finalization; and
- explicitly scope v1 to transaction-receipt verification rather than
  protocol-specific bridge-event verification.

The direct-contract suite covers these adversarial cases and passes 19 tests.
The corrected contracts, source-level replay boundary, target deactivation,
and target-version invalidation are verified on StudioNet.

## Corrected StudioNet deployment

- BridgeProof: `0xd44F249529105B1D623b59974B88ee5D31fFB5E5`
- BridgeProof deployment: `0xae3082e03f4c246f30d051d8526a9bed1ac744b5a6bb6f2d8b98dc9c08800fcd`
- GuardedExecutor: `0xCb3AF5ba18e2a072993604dC1e64eF5F7cC8af5F`
- GuardedExecutor deployment: `0x0a7a98002f0cfea4d276adeb3a4b281361b806d83a11eef5ba64aca08d6a9da5`
- Registered target: `sepolia-receipt-v2`, active, version `1`
- Target registration: `0x1a44008093ab8b9fb0fb3e417b25c12ef9d600c7f6102e17ef6fff91ddced0d9`
- Public app: `https://bridgeproof.vercel.app`

The target description explicitly limits the product to transaction receipt
fields and finality. It does not claim protocol-specific bridge-message event
verification.

### Corrected positive and source-replay runs

- Approved proof: `proof-mv1j1p98`
- Source transaction: `0xb6685ef5d7a688c1582725145677f129452b205c27c083cff036ecb56a060ac4`
- Readback: `approved / MATCH_CONFIRMED / high`, target version `1`, permit
  nonce `1`, and the source authorization points to `proof-mv1j1p98`.
- Replay proof attempted: `proof-mv1kgr1f`
- Replay transaction: `0xf1292e168acaf980398eeaff6c5cd82d3d52f63264d4798af75079e03bd06781`
- Consensus: `MAJORITY_AGREE`; every validator execution result was `ERROR`.
- Contract result: rollback `[EXPECTED] Source transaction already authorized`.
- Post-transaction readback: no second proof was stored and the source
  authorization remained bound to `proof-mv1j1p98`.

This run also exposed a client bug: the original UI interpreted validator
agreement as write success even when all validators agreed on a rollback. The
receipt parser now requires an explicit successful execution result, handles
StudioNet's snake-case receipt fields, surfaces the rollback message, and fails
closed when execution status is absent. Sixteen frontend tests cover both the
success and rollback receipt shapes.

### Corrected target lifecycle runs

A separate target and approved proof were created so target mutation could be
tested without consuming the permit:

- Target: `sepolia-receipt-lifecycle-v1`
- Approved proof: `lifecycle-v1-20261010`, target version `1`
- Source transaction: `0xa4e2526ed51ad14d633dd30024a9bc661ce2a6656061645561394299bebaabfe`
- Assessment: `0x2a3e033bbfc7dad59cd790fd9a9f00df468e990f711682932de4d3fa5502aec9`
- Corrected executor deployment: `0x0a7a98002f0cfea4d276adeb3a4b281361b806d83a11eef5ba64aca08d6a9da5`
- Inactive executor binding: `0x59a8ffa2cc7bcda967a53e822b2d8eb9fc8bbced0544bc59ccd471ddb920c9ce`
- Inactive execution attempt: `0x55c736a4481fdb52c0a4cec7b85808678f2428e31e9a12b480e829dc42364be5`
- Inactive result: finalized rollback `[EXPECTED] Target is inactive`.
- Reactivation/version update: `0x7f4b17a088d2dba05e75586d1e4f7f91b64d2dfb5043618314e9bc259cdb0f19`
- Stale-version execution attempt: `0x3fb8562357b5e70f181fbdb54d6fd7e878f5c91bb1ca4759c014417bafbc4fc8`
- Stale-version result: finalized rollback `[EXPECTED] Target version has changed`.
- Final target readback: active, version `4`, executor
  `0xCb3AF5ba18e2a072993604dC1e64eF5F7cC8af5F`.
- Final permit readback for the version-1 proof: `false`.

The first corrected executor deployment exposed a Studio constructor-encoding
issue when an `Address` argument was persisted as an `addr#...` marker. The
deployed replacement accepts a validated `0x` string, stores its canonical
lowercase form, and successfully reaches the target activation/version checks.

This report records the first real StudioNet-to-Sepolia execution path. It uses the
unlocked RepLayer account for signing and a live Blockscout Sepolia receipt as the
source-chain evidence. No seeded browser state or simulated success response was
used.

## Deployed contracts

- BridgeProof: `0x8CC795B5f029D91E7e19F9e3d4810d6d841351f0`
- BridgeProof deployment: `0x22d4659248d2afa770d2b5bc56be9071fbeb8efa85364a26a2963c8fe618d104`
- GuardedExecutor: `0x58dfB406783B14Fb7062098328933418D79A936d`
- GuardedExecutor deployment: `0xa110d3932a2b0515f42c19f71cef3273520bdab576fd9d2539d1e7e113ce29d9`
- StudioNet chain ID: `61999`
- Registered target: `sepolia-transfer`
- Source chain ID: `11155111`
- Finality depth: `12`

The target was updated after the corrected executor deployment. Target update
transaction: `0xf4d829691e9ee5cb37d21d9974c816a11cc2e84832e1688204c9206b3b4f200f`.
The final readback reports target version `2`, binds the executor to
`0x58dfB406783B14Fb7062098328933418D79A936d`, and stores the live Blockscout
transaction and logs URL templates.

## Source-chain evidence

- Transaction: `0xb6685ef5d7a688c1582725145677f129452b205c27c083cff036ecb56a060ac4`
- Status: `ok`
- Confirmations observed by the contract: `68`
- Sender: `0xefecd3d5ab5740afda9f2a8800738261a4cfc769`
- Recipient: `0x433709009b8330fda32311df1c2afa402ed8d009`
- Value: `908519421519504`
- Nonce: `26`
- Payload hash: `0x820f9beb529460a4ece30817f080539dfce24dc4b24a27828eff83eaadef3448`
- Logs returned: `2`

## StudioNet transaction sequence

### Open proof

- Proof ID: `live-sepolia-20261007-r5`
- Transaction: `0xa078fc2d441f594f67addc59e1047e2f703134fa6bb810341e64f60274d784f9`
- Consensus: `MAJORITY_AGREE`
- Participating execution: `SUCCESS`
- Readback: `status=pending`, target version `2`, with all claimed fields preserved exactly.

### Assess proof

- Transaction: `0x9efabefc664bef0207fda701065b2fa330f50d46f54ca22cf38aae669fdaaafb`
- Consensus: `MAJORITY_AGREE`
- Readback: `status=approved`, `outcome=approved`, `reason_code=MATCH_CONFIRMED`,
  `confidence_band=high`, `observed_confirmations=3203`, and a non-empty source
  snapshot containing both authoritative endpoint responses.

### Start guarded execution

- Transaction: `0x2ad762df0ee3346c28c739046bac4f753141674dd738537b060ead7dcb2268bb`
- Consensus: `MAJORITY_AGREE`
- Cross-contract message: `GuardedExecutor -> BridgeProof.consume_permit`
- Readback after the message settled: `BridgeProof.status=permit_consumed`,
  `consumed=true`, `is_permit_valid=false`, executor `status=awaiting_permit`.

### Finalize execution

- Transaction: `0x5d08922ef9b762909d362005d5f463e14741b5341c4d95a4b54cc87b1d597832`
- Consensus: `MAJORITY_AGREE`
- Readback: executor `status=finalized`, with non-zero `started_at` and
  `finalized_at`.

### Replay protection

- Replay transaction: `0x04a43db4313aaba1ca990c589f8c4ae48cbfd7cc3d2c5a35f78a33294c79a1be`
- Consensus finalized, but contract execution rolled back with
  `[EXPECTED] Execution already started`.
- Final readback remained `permit_consumed` and `finalized`; no second execution
  record was created.

## Adversarial live cases

Each case used a separate proof ID and the same real Sepolia receipt unless noted.
Every assessment reached StudioNet consensus and the final decision was read back
from `get_proof`.

| Case | Assessment transaction | Final readback |
| --- | --- | --- |
| Wrong recipient | `0x3abb3341faf1f2ba756d7ec29d9fbe34a4638cf6ebe14d53364664617b8b59a6` | `rejected / RECIPIENT_MISMATCH`, permit nonce `0` |
| Wrong payload | `0x8bba262e8ca6bca93fc9a8d3e48611190d82554ae9b29c1b360b89d7308a79b7` | `rejected / PAYLOAD_MISMATCH`, permit nonce `0` |
| Missing source transaction | `0xc99896a045773a1116e98ed488bbb2c69bac73836990042246403c47d3cf0ece` | `insufficient_evidence / SOURCE_FAILURE`, no observed evidence |
| Insufficient finality | `0xe3fbe4b597d33334e8666ec6a2e01b2bc6247100e48d7c9b1b9aa2c49d5ddf69` | `rejected / INSUFFICIENT_FINALITY`, permit nonce `0` |

Fresh post-browser rejection check:

- Proof ID: `adversarial-wrong-recipient-20261007-r3`
- Open transaction: `0x5f533bcb60e4d1f546135313d8dd4f7aaa0bbfecc164f22ce5b74e7fc75b94c1`
- Assessment transaction: `0x17b391f48650d59adf835eca282663eb705a9f8dda8f6eaf9aab816f3647e65b`
- Final readback: `rejected / RECIPIENT_MISMATCH`, confidence `high`, observed recipient matched the real receipt, permit nonce `0`, `consumed=false`, and `is_permit_valid=false`.
- Guarded executor readback: no execution record for the rejected proof.

The wrong-caller permit was intentionally valid so the authorization boundary was
tested independently:

- Proof assessment: `0x22aeda43a1e6ea718796ec840241f6a037e29149d236b1f27c1a5a45c879c354`
- Unauthorized `consume_permit`: `0xd0fe5a31e23d4b5b72ab3c7f9cdf18aabd171835d2ecd8231ad962f08435a305`
- Contract result: rollback `[EXPECTED] Caller is not the executor`.
- Readback remained `approved`, permit nonce `2`, `consumed=false`.

The expired proof open transaction was `0xed2791eae1edf326443efc6d401d5e39354f3f9273d06898a20f627516b19ac6`.
Its leader execution rolled back with `[EXPECTED] valid_until must be in the future`,
and no proof was stored.

## Browser refresh and reconnect

- Loaded the deep public route `/proofs/adversarial-wrong-recipient-20261007-r3`
  while logged out and reconstructed `rejected / RECIPIENT_MISMATCH`, the source
  fields, rationale, finality, and explorer link from chain state.
- Reloaded the same deep route and confirmed the state returned after the client
  finished its read-only reconciliation.
- Reconnected the actual Rabby extension and refreshed the proof. The account
  displayed as `0x1dcb…32d2`, while the proof remained rejected and no guarded
  action control appeared.
- Added an explicit Vercel SPA rewrite so shared `/proofs/{proof_id}` URLs reach
  the application shell instead of a host-level 404.

## Remaining release gates

The corrected StudioNet deployment now proves the positive path end to end,
including live source fetches, target-version rebinding, cross-contract permit
consumption, finalization, and replay protection. The rejection path and actual
Rabby refresh/reconnect path are also verified. The earlier executor deployment
was replaced after a live call exposed that the CLI constructor encoding could
persist an `addr#...` marker; address normalization now strips that marker before
cross-contract lookup. Public deployment and final-host inspection remain the
release gates before Project submission.
