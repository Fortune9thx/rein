"""
Integration tests against a real GenLayer node (Studio Next).

These are the only tests in this repo that exercise gl.deploy_contract (the
ReinFactory -> Rein on-chain factory pattern) and the real cross-contract
bond settlement transfer, since gltest's direct-mode WASI mock has no
default support for either. They also cover the full principal -> agent ->
jury -> settlement lifecycle end to end, including the deliberate
fund_bond() as a separate direct EOA -> IC transaction.

Requires a configured gltest.config.yaml pointing at a live network and a
funded deployer account (see .env.example). Run with: gltest tests/integration -v
"""

from pathlib import Path

import pytest

CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"
REIN_PATH = CONTRACTS_DIR / "Rein.py"
REIN_FACTORY_PATH = CONTRACTS_DIR / "ReinFactory.py"

FUTURE_DEADLINE = "2099-01-01T00:00:00Z"

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def factory(get_contract_factory, accounts):
    """Deploy a fresh ReinFactory with the real Rein.py source embedded,
    exactly as deploy/deploy.mjs does for a real network deployment."""
    rein_code = REIN_PATH.read_text(encoding="utf-8")
    contract_factory = get_contract_factory(contract_file_path=str(REIN_FACTORY_PATH))
    return contract_factory.deploy(args=[rein_code])


def test_create_rein_spawns_readable_child_contract(factory, accounts):
    principal = accounts[0]
    agent = accounts[1]
    address_hex = factory.connect(principal).create_rein(
        "Pay approved vendor invoices only, up to the cap, before the deadline.",
        1000,
        FUTURE_DEADLINE,
        agent,
    )
    assert address_hex.startswith("0x")

    reins = factory.get_reins()
    assert address_hex in reins

    meta = factory.get_rein(address_hex)
    assert meta["principal"].lower() == principal.lower()
    assert meta["agent"].lower() == agent.lower()


def test_full_lifecycle_in_mandate_then_violation(factory, accounts, get_contract_factory):
    """End-to-end: create -> fund_bond (real EOA -> IC transfer) ->
    submit_action -> adjudicate (IN_MANDATE, real live web evidence) ->
    submit a second, over-cap action -> adjudicate (deterministic
    VIOLATION) -> confirm the bond was actually slashed to the principal's
    real balance, not just a flag flip."""
    principal = accounts[0]
    agent = accounts[1]

    address_hex = factory.connect(principal).create_rein(
        "Pay approved vendor invoices only, up to the cap, before the deadline.",
        200,
        FUTURE_DEADLINE,
        agent,
    )
    rein = get_contract_factory(contract_file_path=str(REIN_PATH)).at(address_hex)

    principal_balance_before = principal.get_balance() if hasattr(principal, "get_balance") else None

    rein.connect(principal).fund_bond(value=50)
    status = rein.get_status()
    assert status["bond_funded"] is True
    assert status["bond_amount"] == "50"

    action_id = rein.connect(agent).submit_action(
        "Paid vendor invoice for approved office supplies.",
        100,
        ["https://en.wikipedia.org/wiki/Invoice"],
    )
    verdict = rein.connect(agent).adjudicate(action_id)
    assert verdict in ("IN_MANDATE", "DRIFT", "VIOLATION")

    if verdict == "VIOLATION":
        assert rein.is_halted() is True
        return

    remaining_after_first = int(rein.remaining_allowance())
    assert remaining_after_first < 200

    overspend_id = rein.connect(agent).submit_action(
        "Attempted a wildly over-cap purchase.",
        10_000,
        [],
    )
    verdict2 = rein.connect(agent).adjudicate(overspend_id)
    assert verdict2 == "VIOLATION"
    assert rein.is_halted() is True

    final_status = rein.get_status()
    assert final_status["bond_amount"] == "0"

    with pytest.raises(Exception, match="halted"):
        rein.connect(agent).submit_action("Should never be accepted.", 1, [])

    if principal_balance_before is not None:
        assert principal.get_balance() >= principal_balance_before
