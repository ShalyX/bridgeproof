# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
from datetime import datetime, timezone

from genlayer import *


ERROR_EXPECTED = "[EXPECTED]"
MAX_ID_LENGTH = 100


@allow_storage
@dataclass
class Execution:
    proof_id: str
    target_id: str
    status: str
    started_at: u256
    finalized_at: u256


class GuardedExecutor(gl.Contract):
    """Example downstream action that cannot bypass BridgeProof permits."""

    bridge_proof: str
    executions: TreeMap[str, Execution]
    execution_order: DynArray[str]

    def __init__(self, bridge_proof: Address):
        self.bridge_proof = self._address_text(bridge_proof)

    def _now(self) -> int:
        return int(datetime.now(timezone.utc).timestamp())

    def _address_text(self, value) -> str:
        try:
            text = value.as_hex
        except AttributeError:
            text = str(value)
        text = text.strip().lower()
        if text.startswith("addr#"):
            text = text[5:]
        return text

    def _guard(self):
        bridge_proof = self.bridge_proof.strip()
        if bridge_proof.lower().startswith("addr#"):
            bridge_proof = bridge_proof[5:]
        return gl.get_contract_at(Address(bridge_proof))

    def _get_execution(self, proof_id: str) -> Execution:
        if proof_id not in self.executions:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Execution not found")
        return self.executions[proof_id]

    def _execution_to_dict(self, execution: Execution) -> dict:
        return {
            "proof_id": execution.proof_id,
            "target_id": execution.target_id,
            "status": execution.status,
            "started_at": execution.started_at,
            "finalized_at": execution.finalized_at,
        }

    @gl.public.write
    def start_execution(self, proof_id: str) -> None:
        if not proof_id or len(proof_id) > MAX_ID_LENGTH:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} invalid proof_id")
        if proof_id in self.executions:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Execution already started")

        guard = self._guard()
        proof = guard.view().get_proof(proof_id)
        target = guard.view().get_target(proof["target_id"])
        if proof["status"] != "approved" or proof["consumed"]:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} No valid BridgeProof permit")
        if self._address_text(target["executor"]) != self._address_text(
            gl.message.contract_address
        ):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Executor is not registered")
        if proof["valid_until"] <= self._now():
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Permit has expired")

        self.executions[proof_id] = Execution(
            proof_id=proof_id,
            target_id=proof["target_id"],
            status="awaiting_permit",
            started_at=self._now(),
            finalized_at=0,
        )
        self.execution_order.append(proof_id)
        guard.emit(on="finalized").consume_permit(proof_id)

    @gl.public.write
    def finalize_execution(self, proof_id: str) -> None:
        execution = self._get_execution(proof_id)
        if execution.status != "awaiting_permit":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Execution is not pending")

        proof = self._guard().view().get_proof(proof_id)
        if proof["status"] != "permit_consumed" or not proof["consumed"]:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Permit has not been consumed")

        execution.status = "finalized"
        execution.finalized_at = self._now()

    @gl.public.view
    def get_execution(self, proof_id: str) -> dict:
        return self._execution_to_dict(self._get_execution(proof_id))

    @gl.public.view
    def get_execution_ids(self) -> dict:
        return {
            str(index): self.execution_order[index]
            for index in range(len(self.execution_order))
        }

