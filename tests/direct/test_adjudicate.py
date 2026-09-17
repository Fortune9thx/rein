"""
Direct-mode tests for Rein.adjudicate().

adjudicate() has two paths: deterministic pre-checks (overspend, past
deadline) that skip the LLM entirely, and the nondet jury path -- a single
gl.vm.run_nondet_unsafe call per the genvm-lint one-nondet-call-per-method
rule, with all evidence fetches folded inside the same leader closure.
"""

import json

from gltest.direct import VMContext, deploy_contract, create_test_addresses

from conftest import REIN_PATH, to_hex

FUTURE_DEADLINE = "2099-01-01T00:00:00Z"


def _wrapped_json(payload: dict) -> str:
    return f"Here is my analysis.\n```json\n{json.dumps(payload)}\n```\nEnd of response."


def _deploy(vm, principal, agent, mandate="Pay approved vendor invoices only, up to the cap.", spend_cap=1000, deadline=FUTURE_DEADLINE):
    vm.sender = principal
    return deploy_contract(REIN_PATH, vm, to_hex(principal), to_hex(agent), mandate, spend_cap, deadline)


def _fund(rein, vm, principal, amount=1000):
    vm.sender = principal
    vm.value = amount
    rein.fund_bond()


def _submit(rein, vm, agent, description="Pay vendor invoice #42.", amount=100, urls=None):
    vm.sender = agent
    return rein.submit_action(description, amount, urls or ["https://example.com/invoice"])


def _mock_jury(vm, verdict, confidence="0.9", reason="Consistent with the mandate.", recommended_remaining_cap=900, kill_switch=None):
    if kill_switch is None:
        kill_switch = verdict == "VIOLATION"
    vm.mock_web(r"example\.com/invoice", {"method": "GET", "status": 200, "body": "Invoice for approved vendor, $100."})
    vm.mock_llm(
        r"mandate jury",
        _wrapped_json(
            {
                "verdict": verdict,
                "confidence": confidence,
                "reason": reason,
                "recommended_remaining_cap": recommended_remaining_cap,
                "kill_switch": kill_switch,
            }
        ),
    )


def test_adjudicate_in_mandate_decrements_remaining_cap():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal)
        action_id = _submit(rein, vm, agent, amount=100)
        _mock_jury(vm, "IN_MANDATE", recommended_remaining_cap=900)

        vm.sender = agent
        verdict = rein.adjudicate(action_id)
        assert verdict == "IN_MANDATE"

        status = rein.get_status()
        assert status["remaining_cap"] == "900"
        assert status["kill_switch"] is False
        assert status["last_verdict"] == "IN_MANDATE"

        record = rein.get_action(action_id)
        assert record["verdict"] == "IN_MANDATE"


def test_adjudicate_drift_raises_threat_score_without_halting():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal)
        action_id = _submit(rein, vm, agent, amount=100)
        _mock_jury(vm, "DRIFT", recommended_remaining_cap=850, kill_switch=False)

        vm.sender = agent
        verdict = rein.adjudicate(action_id)
        assert verdict == "DRIFT"

        status = rein.get_status()
        assert status["threat_score"] == "15"
        assert status["kill_switch"] is False


def test_adjudicate_violation_sets_kill_switch():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal)
        action_id = _submit(rein, vm, agent, amount=100)
        _mock_jury(vm, "VIOLATION", recommended_remaining_cap=1000, kill_switch=True)

        vm.sender = agent
        verdict = rein.adjudicate(action_id)
        assert verdict == "VIOLATION"
        assert rein.is_halted() is True
        assert rein.get_status()["threat_score"] == "40"


def test_adjudicate_overspend_is_deterministic_violation_without_llm():
    """amount > remaining_cap must trip VIOLATION and the kill switch WITHOUT
    any mock_llm/mock_web registered -- proving the deterministic pre-check
    short-circuits before the nondet jury path is ever reached."""
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent, spend_cap=100)
        _fund(rein, vm, principal)
        action_id = _submit(rein, vm, agent, amount=500)

        vm.sender = agent
        verdict = rein.adjudicate(action_id)
        assert verdict == "VIOLATION"
        assert rein.is_halted() is True
        assert "exceeds remaining cap" in rein.get_status()["last_reason"]


def test_adjudicate_dead_evidence_link_still_completes():
    """A dead/unmocked evidence URL must not crash adjudicate() -- the
    leader closure catches the fetch failure and substitutes UNAVAILABLE,
    still returning a real verdict."""
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal)
        action_id = _submit(rein, vm, agent, amount=100, urls=["https://dead-link.example/nowhere"])
        vm.mock_llm(
            r"mandate jury",
            _wrapped_json(
                {
                    "verdict": "IN_MANDATE",
                    "confidence": "0.6",
                    "reason": "No corroborating evidence, but description is plausible.",
                    "recommended_remaining_cap": 900,
                    "kill_switch": False,
                }
            ),
        )
        vm.sender = agent
        verdict = rein.adjudicate(action_id)
        assert verdict == "IN_MANDATE"


def test_adjudicate_rejects_unknown_action_id():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal)
        vm.sender = agent
        with vm.expect_revert("Unknown action id"):
            rein.adjudicate(99)


def test_adjudicate_cannot_run_twice_on_same_action():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal)
        action_id = _submit(rein, vm, agent, amount=100)
        _mock_jury(vm, "IN_MANDATE")
        vm.sender = agent
        rein.adjudicate(action_id)
        with vm.expect_revert("already been adjudicated"):
            rein.adjudicate(action_id)


def test_submit_action_reverts_after_kill_switch_engaged():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent, spend_cap=100)
        _fund(rein, vm, principal)
        action_id = _submit(rein, vm, agent, amount=500)
        vm.sender = agent
        rein.adjudicate(action_id)
        assert rein.is_halted() is True

        with vm.expect_revert("halted"):
            rein.submit_action("Try again.", 10, [])
