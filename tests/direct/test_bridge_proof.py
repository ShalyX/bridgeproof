import hashlib
import json
import time


CONTRACT = "contracts/bridge_proof.py"
EXECUTOR = "0x2222222222222222222222222222222222222222"
SOURCE_CHAIN = "11155111"
TX_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
SENDER = "0x1111111111111111111111111111111111111111"
RECIPIENT = "0x3333333333333333333333333333333333333333"
TARGET_TX_URL = "https://source.example/api/transactions/{tx_hash}"
TARGET_LOGS_URL = "https://source.example/api/transactions/{tx_hash}/logs"


def payload_hash(raw_input: str) -> str:
    return "0x" + hashlib.sha256(raw_input.encode()).hexdigest()


def deploy(direct_deploy):
    return direct_deploy(CONTRACT, sdk_version="v0.2.16")


def register_default_target(contract, direct_vm, direct_alice):
    direct_vm.sender = direct_alice
    contract.register_target(
        "sepolia-transfer",
        SOURCE_CHAIN,
        "Sepolia source receipt",
        "A bounded source-chain receipt target for the first BridgeProof integration.",
        TARGET_TX_URL,
        TARGET_LOGS_URL,
        EXECUTOR,
        12,
    )


def open_default_proof(contract, direct_vm, direct_bob, proof_id="proof-1"):
    direct_vm.sender = direct_bob
    contract.open_proof(
        proof_id,
        "sepolia-transfer",
        SOURCE_CHAIN,
        TX_HASH,
        SENDER,
        RECIPIENT,
        100,
        payload_hash("0x1234"),
        7,
        12,
        int(time.time()) + 3600,
    )


def mock_sources(direct_vm, confirmations=20, status="ok"):
    tx = {
        "hash": TX_HASH,
        "status": status,
        "from": {"hash": SENDER},
        "to": {"hash": RECIPIENT},
        "value": "100",
        "raw_input": "0x1234",
        "nonce": 7,
        "confirmations": confirmations,
    }
    direct_vm.mock_web(
        r"https://source\.example/api/transactions/0x[aA]+$",
        {"status": 200, "body": json.dumps(tx)},
    )
    direct_vm.mock_web(
        r"https://source\.example/api/transactions/0x[aA]+/logs$",
        {"status": 200, "body": json.dumps({"items": []})},
    )


def mock_blockscout_alias_sources(direct_vm):
    tx = {
        "hash": TX_HASH,
        "result": "success",
        "from": SENDER,
        "to": RECIPIENT,
        "value": "0x64",
        "input": "0x1234",
        "nonce": "0x7",
        "confirmations": "0x14",
    }
    direct_vm.mock_web(
        r"https://source\.example/api/transactions/0x[aA]+$",
        {"status": 200, "body": json.dumps(tx)},
    )
    direct_vm.mock_web(
        r"https://source\.example/api/transactions/0x[aA]+/logs$",
        {"status": 200, "body": json.dumps({"items": []})},
    )


def mock_review(direct_vm, outcome="approved", confidence="high", reason="MATCH_CONFIRMED"):
    direct_vm.mock_llm(
        r"(?s).*impartial source-chain receipt reviewer.*",
        json.dumps(
            {
                "outcome": outcome,
                "confidence_band": confidence,
                "reason_code": reason,
                "rationale": "The fetched receipt evidence is coherent for the declared claim.",
            }
        ),
    )


def test_register_and_open_proof_store_claim_and_target_version(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy(direct_deploy)
    register_default_target(contract, direct_vm, direct_alice)
    open_default_proof(contract, direct_vm, direct_bob)

    target = contract.get_target("sepolia-transfer")
    proof = contract.get_proof("proof-1")

    assert target["source_chain_id"] == SOURCE_CHAIN
    assert target["version"] == 1
    assert target["finality_depth"] == 12
    assert proof["reporter"].lower() == f"0x{direct_bob.hex()}".lower()
    assert proof["target_version"] == 1
    assert proof["status"] == "pending"
    assert proof["permit_nonce"] == 0
    assert contract.get_target_ids() == {"0": "sepolia-transfer"}
    assert contract.get_proof_ids() == {"0": "proof-1"}


def test_matching_receipt_reaches_approved_and_consumable_permit(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy(direct_deploy)
    register_default_target(contract, direct_vm, direct_alice)
    open_default_proof(contract, direct_vm, direct_bob)
    mock_sources(direct_vm)
    mock_review(direct_vm)

    direct_vm.sender = direct_alice
    contract.assess_proof("proof-1")

    proof = contract.get_proof("proof-1")
    assert proof["status"] == "approved"
    assert proof["outcome"] == "approved"
    assert proof["reason_code"] == "MATCH_CONFIRMED"
    assert proof["permit_nonce"] == 1
    assert proof["observed_sender"] == SENDER
    assert proof["observed_recipient"] == RECIPIENT
    assert proof["observed_confirmations"] == 20
    assert contract.is_permit_valid("proof-1") is True

    direct_vm.sender = bytes.fromhex(EXECUTOR[2:])
    contract.consume_permit("proof-1")
    assert contract.get_proof("proof-1")["status"] == "permit_consumed"

    with direct_vm.expect_revert("Proof has no active permit"):
        contract.consume_permit("proof-1")


def test_blockscout_alias_fields_are_normalized(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy(direct_deploy)
    register_default_target(contract, direct_vm, direct_alice)
    open_default_proof(contract, direct_vm, direct_bob)
    mock_blockscout_alias_sources(direct_vm)
    mock_review(direct_vm)

    direct_vm.sender = direct_alice
    contract.assess_proof("proof-1")

    proof = contract.get_proof("proof-1")
    assert proof["status"] == "approved"
    assert proof["reason_code"] == "MATCH_CONFIRMED"
    assert proof["observed_value"] == 100
    assert proof["observed_nonce"] == 7
    assert proof["observed_confirmations"] == 20


def test_wrong_recipient_is_rejected_without_permit(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy(direct_deploy)
    register_default_target(contract, direct_vm, direct_alice)
    open_default_proof(contract, direct_vm, direct_bob)
    mock_sources(direct_vm)
    mock_review(direct_vm)

    direct_vm.sender = direct_alice
    contract.open_proof(
        "proof-wrong-recipient",
        "sepolia-transfer",
        SOURCE_CHAIN,
        TX_HASH,
        SENDER,
        "0x4444444444444444444444444444444444444444",
        100,
        payload_hash("0x1234"),
        7,
        12,
        int(time.time()) + 3600,
    )
    contract.assess_proof("proof-wrong-recipient")

    proof = contract.get_proof("proof-wrong-recipient")
    assert proof["status"] == "rejected"
    assert proof["reason_code"] == "RECIPIENT_MISMATCH"
    assert proof["permit_nonce"] == 0


def test_source_outage_fails_closed_and_can_be_retried(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy(direct_deploy)
    register_default_target(contract, direct_vm, direct_alice)
    open_default_proof(contract, direct_vm, direct_bob)
    direct_vm.mock_web(
        r"https://source\.example/api/transactions/0x[aA]+$",
        {"status": 503, "body": "temporary outage"},
    )
    direct_vm.mock_web(
        r"https://source\.example/api/transactions/0x[aA]+/logs$",
        {"status": 503, "body": "temporary outage"},
    )
    mock_review(direct_vm, "insufficient_evidence", "low", "SOURCE_FAILURE")

    contract.assess_proof("proof-1")
    assert contract.get_proof("proof-1")["status"] == "insufficient_evidence"
    assert contract.get_proof("proof-1")["permit_nonce"] == 0

    contract.retry_assessment("proof-1")
    assert contract.get_proof("proof-1")["status"] == "pending"


def test_insufficient_finality_is_rejected(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy(direct_deploy)
    register_default_target(contract, direct_vm, direct_alice)
    open_default_proof(contract, direct_vm, direct_bob)
    mock_sources(direct_vm, confirmations=3)
    mock_review(direct_vm, "rejected", "high", "INSUFFICIENT_FINALITY")

    contract.assess_proof("proof-1")
    proof = contract.get_proof("proof-1")
    assert proof["status"] == "rejected"
    assert proof["reason_code"] == "INSUFFICIENT_FINALITY"
    assert proof["permit_nonce"] == 0


def test_target_update_invalidates_old_proof(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy(direct_deploy)
    register_default_target(contract, direct_vm, direct_alice)
    open_default_proof(contract, direct_vm, direct_bob)

    direct_vm.sender = direct_alice
    contract.update_target(
        "sepolia-transfer",
        "Updated source target",
        TARGET_TX_URL,
        TARGET_LOGS_URL,
        EXECUTOR,
        24,
        True,
    )
    contract.assess_proof("proof-1")

    proof = contract.get_proof("proof-1")
    assert proof["status"] == "invalidated"
    assert proof["permit_nonce"] == 0


def test_only_owner_can_update_and_wrong_executor_cannot_consume(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy(direct_deploy)
    register_default_target(contract, direct_vm, direct_alice)
    open_default_proof(contract, direct_vm, direct_bob)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the target owner may do this"):
        contract.update_target(
            "sepolia-transfer",
            "Attacker update",
            TARGET_TX_URL,
            TARGET_LOGS_URL,
            EXECUTOR,
            12,
            True,
        )

    mock_sources(direct_vm)
    mock_review(direct_vm)
    direct_vm.sender = direct_alice
    contract.assess_proof("proof-1")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Caller is not the executor"):
        contract.consume_permit("proof-1")


def test_claim_cannot_lower_target_finality_requirement(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy(direct_deploy)
    register_default_target(contract, direct_vm, direct_alice)
    direct_vm.sender = direct_bob

    with direct_vm.expect_revert("min_confirmations is below target finality_depth"):
        contract.open_proof(
            "proof-weak-finality",
            "sepolia-transfer",
            SOURCE_CHAIN,
            TX_HASH,
            SENDER,
            RECIPIENT,
            100,
            payload_hash("0x1234"),
            7,
            3,
            int(time.time()) + 3600,
        )
