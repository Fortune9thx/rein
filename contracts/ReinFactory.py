# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import json
from datetime import datetime

import genlayer as gl
from genlayer.types import *
from genlayer.storage import TreeMap, DynArray

MAX_MANDATE_LEN = 4000


def _consensus_now() -> int:
    raw = gl.message.raw["datetime"]
    return int(datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp())


def _normalize_address(addr: str) -> str:
    return addr.strip().lower()


class ReinFactory(gl.contract.Contract):
    """
    Registry + on-chain factory for Rein mandate objects.

    Deploys a fresh `Rein` contract instance per mandate via
    gl.contract.deploy, mirroring the verified genlayerlabs/intelligent-oracle
    Registry pattern. `create_rein` never carries value: the principal bond
    is funded in a separate, direct EOA -> Rein transaction
    (`Rein.fund_bond()`) after this call returns the new address, because a
    factory forwarding msg.value into a just-deployed child would be an
    IC -> IC value transfer -- a confirmed dead end on this GenVM build.
    Registry metadata is read-only creation-time data; live status (cap,
    threat score, kill switch) must always be read directly from the Rein
    contract itself.
    """

    rein_code: str
    rein_addresses: DynArray[str]
    # rein_address_hex(normalized) -> JSON {address, mandate, spend_cap,
    #                                        deadline, agent, principal, created_at}
    rein_meta: TreeMap[str, str]
    # principal_address_hex(normalized) -> DynArray[str] of rein address hexes
    reins_by_principal: TreeMap[str, DynArray[str]]
    # agent_address_hex(normalized) -> DynArray[str] of rein address hexes
    reins_by_agent: TreeMap[str, DynArray[str]]

    def __init__(self, rein_code: str):
        if not rein_code:
            raise gl.vm.UserError("Missing Rein contract source code.")
        self.rein_code = rein_code

    @gl.public.write
    def create_rein(self, mandate: str, spend_cap: u256, deadline: str, agent: str) -> str:
        if not mandate or len(mandate) > MAX_MANDATE_LEN:
            raise gl.vm.UserError(f"mandate is required and must be at most {MAX_MANDATE_LEN} characters.")
        if int(spend_cap) <= 0:
            raise gl.vm.UserError("spend_cap must be positive.")
        if not agent:
            raise gl.vm.UserError("An agent address is required.")

        principal_hex = gl.message.sender_address.as_hex
        agent_address = Address(agent)

        registered = len(self.rein_addresses)
        contract_address = gl.contract.deploy(
            code=self.rein_code.encode("utf-8"),
            args=[principal_hex, agent_address.as_hex, mandate, spend_cap, deadline],
            salt_nonce=registered + 1,
        )
        address_hex = contract_address.as_hex
        self.rein_addresses.append(address_hex)

        meta = {
            "address": address_hex,
            "mandate": mandate,
            "spend_cap": str(int(spend_cap)),
            "deadline": deadline,
            "agent": agent_address.as_hex,
            "principal": principal_hex,
            "created_at": str(_consensus_now()),
        }
        self.rein_meta[_normalize_address(address_hex)] = json.dumps(meta)

        # get_or_insert_default() is the storage-safe way to obtain a nested
        # container value inside a TreeMap -- manually constructing
        # DynArray[str]() and assigning it via __setitem__ does not go
        # through the framework's storage-slot allocation path and is a
        # confirmed live crash (exit_code 1) on this GenVM build.
        principal_key = _normalize_address(principal_hex)
        self.reins_by_principal.get_or_insert_default(principal_key).append(address_hex)

        agent_key = _normalize_address(agent_address.as_hex)
        self.reins_by_agent.get_or_insert_default(agent_key).append(address_hex)

        return address_hex

    @gl.public.view
    def get_rein(self, address: str) -> dict:
        raw = self.rein_meta.get(_normalize_address(address), "")
        if not raw:
            raise gl.vm.UserError("Unknown Rein address.")
        return json.loads(raw)

    @gl.public.view
    def get_reins(self) -> list[str]:
        return list(self.rein_addresses)

    @gl.public.view
    def get_reins_count(self) -> int:
        return len(self.rein_addresses)

    @gl.public.view
    def get_reins_page(self, offset: int, limit: int) -> list[str]:
        if offset < 0 or limit <= 0:
            return []
        addresses = list(self.rein_addresses)
        return addresses[offset : offset + limit]

    @gl.public.view
    def reins_by_principal_address(self, principal_address: str) -> list[str]:
        key = _normalize_address(principal_address)
        if key not in self.reins_by_principal:
            return []
        return list(self.reins_by_principal[key])

    @gl.public.view
    def rein_by_agent_address(self, agent_address: str) -> list[str]:
        key = _normalize_address(agent_address)
        if key not in self.reins_by_agent:
            return []
        return list(self.reins_by_agent[key])
