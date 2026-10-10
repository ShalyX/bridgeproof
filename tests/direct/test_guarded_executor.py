import sys
import time


EXECUTOR_CONTRACT = "contracts/guarded_executor.py"
BRIDGE_PROOF_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


class FakeGuard:
    def __init__(
        self,
        executor_address,
        status="approved",
        active=True,
        target_version=1,
        proof_target_version=1,
    ):
        self.status = status
        self.executor_address = executor_address
        self.active = active
        self.target_version = target_version
        self.proof_target_version = proof_target_version

    def view(self):
        return self

    def get_proof(self, _proof_id):
        return {
            "status": self.status,
            "consumed": self.status == "permit_consumed",
            "valid_until": int(time.time()) + 3600,
            "target_id": "sepolia-transfer",
            "target_version": self.proof_target_version,
        }

    def get_target(self, _target_id):
        return {
            "executor": self.executor_address,
            "active": self.active,
            "version": self.target_version,
        }

    def emit(self, on):
        assert on == "finalized"
        return self

    def consume_permit(self, _proof_id):
        self.status = "permit_consumed"


def deploy_executor(direct_deploy):
    return direct_deploy(
        EXECUTOR_CONTRACT,
        BRIDGE_PROOF_ADDRESS,
        sdk_version="v0.2.16",
    )


def test_guarded_executor_rejects_malformed_guard_address(direct_deploy, direct_vm):
    with direct_vm.expect_revert("invalid bridge_proof address"):
        direct_deploy(EXECUTOR_CONTRACT, "not-an-address", sdk_version="v0.2.16")


def test_guarded_executor_requires_and_finalizes_consumed_permit(
    direct_deploy, monkeypatch
):
    executor = deploy_executor(direct_deploy)
    module = sys.modules[executor._instance.__class__.__module__]
    guard = FakeGuard(executor.address)
    monkeypatch.setattr(module.gl, "get_contract_at", lambda _address: guard)

    executor.start_execution("proof-executor")
    assert executor.get_execution("proof-executor")["status"] == "awaiting_permit"
    assert guard.status == "permit_consumed"

    executor.finalize_execution("proof-executor")
    assert executor.get_execution("proof-executor")["status"] == "finalized"


def test_guarded_executor_rejects_unregistered_executor(
    direct_deploy, direct_vm, monkeypatch
):
    executor = deploy_executor(direct_deploy)
    module = sys.modules[executor._instance.__class__.__module__]
    guard = FakeGuard("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
    monkeypatch.setattr(module.gl, "get_contract_at", lambda _address: guard)

    with direct_vm.expect_revert("Executor is not registered"):
        executor.start_execution("proof-executor")


def test_guarded_executor_rejects_inactive_target(
    direct_deploy, direct_vm, monkeypatch
):
    executor = deploy_executor(direct_deploy)
    module = sys.modules[executor._instance.__class__.__module__]
    guard = FakeGuard(executor.address, active=False)
    monkeypatch.setattr(module.gl, "get_contract_at", lambda _address: guard)

    with direct_vm.expect_revert("Target is inactive"):
        executor.start_execution("proof-executor")


def test_guarded_executor_rejects_stale_target_version(
    direct_deploy, direct_vm, monkeypatch
):
    executor = deploy_executor(direct_deploy)
    module = sys.modules[executor._instance.__class__.__module__]
    guard = FakeGuard(executor.address, target_version=2, proof_target_version=1)
    monkeypatch.setattr(module.gl, "get_contract_at", lambda _address: guard)

    with direct_vm.expect_revert("Target version has changed"):
        executor.start_execution("proof-executor")


def test_guarded_executor_rechecks_target_before_finalization(
    direct_deploy, direct_vm, monkeypatch
):
    executor = deploy_executor(direct_deploy)
    module = sys.modules[executor._instance.__class__.__module__]
    guard = FakeGuard(executor.address)
    monkeypatch.setattr(module.gl, "get_contract_at", lambda _address: guard)

    executor.start_execution("proof-executor")
    guard.active = False

    with direct_vm.expect_revert("Target is inactive"):
        executor.finalize_execution("proof-executor")

