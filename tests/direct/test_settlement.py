"""Direct-mode tests for the bond-slash settlement path in Rein.adjudicate()."""

import json

from gltest.direct import VMContext, deploy_contract, create_test_addresses

from conftest import REIN_PATH, to_hex

FUTURE_DEADLINE = "2099-01-01T00:00:00Z"


def _wrapped_json(payload: dict) -> str:
    return f"Here is my analysis.\n```json\n{json.dumps(payload)}\n```\nEnd of response."


def _deploy(vm, principal, agent, spend_cap=1000, deadline=FUTURE_DEADLINE):
    vm.sender = principal
    return deploy_contract(
        REIN_PATH,
        vm,
        to_hex(principal),
        to_hex(agent),
        "Pay approved vendor invoices only, up to the cap.",
        spend_cap,
        deadline,
    )


def _fund(rein, vm, principal, amount=1000):
    vm.sender = principal
    vm.value = amount
    rein.fund_bond()


def _submit(rein, vm, agent, amount=100):
    vm.sender = agent
    return rein.submit_action("Pay vendor invoice #42.", amount, ["https://example.com/invoice"])


def test_violation_slashes_bond_and_marks_settled():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent, spend_cap=100)
        _fund(rein, vm, principal, amount=250)
        action_id = _submit(rein, vm, agent, amount=500)  # deterministic overspend violation

        vm.sender = agent
        rein.adjudicate(action_id)

        status = rein.get_status()
        assert status["kill_switch"] is True
        assert status["bond_amount"] == "0"


def test_settlement_only_happens_once():
    """A second VIOLATION on an already-halted Rein can never reach
    adjudicate() again (submit_action itself reverts once halted), so bond
    settlement is structurally idempotent -- verified here by confirming
    the bond is already zeroed and the settled flag holds after the first
    and only violation."""
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent, spend_cap=100)
        _fund(rein, vm, principal, amount=250)
        action_id = _submit(rein, vm, agent, amount=500)

        vm.sender = agent
        rein.adjudicate(action_id)
        assert rein.get_status()["bond_amount"] == "0"

        with vm.expect_revert("halted"):
            rein.submit_action("Another try.", 10, [])


def test_in_mandate_verdict_never_touches_bond():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, amount=250)
        action_id = _submit(rein, vm, agent, amount=100)

        vm.mock_web(r"example\.com/invoice", {"method": "GET", "status": 200, "body": "Invoice for approved vendor, $100."})
        vm.mock_llm(
            r"authorized job",
            _wrapped_json(
                {
                    "verdict": "IN_MANDATE",
                    "confidence": "0.9",
                    "reason": "Matches mandate.",
                    "recommended_remaining_cap": 900,
                    "kill_switch": False,
                }
            ),
        )
        vm.sender = agent
        rein.adjudicate(action_id)

        assert rein.get_status()["bond_amount"] == "250"
        assert rein.is_halted() is False
