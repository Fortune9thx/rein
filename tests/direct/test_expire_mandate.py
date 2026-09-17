"""
Direct-mode tests for Rein.expire_mandate() -- the liveness escape hatch that
returns the principal's bond once the deadline has passed with no VIOLATION
ever recorded. Without this, a well-behaved agent's mandate expiring
uneventfully would leave the bond permanently stranded, since _settle_bond()
only ever fires on VIOLATION.
"""

from gltest.direct import VMContext, deploy_contract, create_test_addresses

from conftest import REIN_PATH, to_hex

PAST_DEADLINE = "2020-01-01T00:00:00Z"
FUTURE_DEADLINE = "2099-01-01T00:00:00Z"


def _deploy(vm, principal, agent, deadline=PAST_DEADLINE, spend_cap=1000):
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


def test_expire_mandate_returns_bond_after_deadline():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent, deadline=PAST_DEADLINE)
        _fund(rein, vm, principal, amount=250)

        vm.sender = agent  # permissionless -- not just the principal
        rein.expire_mandate()

        status = rein.get_status()
        assert status["settled"] is True
        assert status["bond_amount"] == "0"
        assert status["kill_switch"] is False  # expiring is not a violation


def test_expire_mandate_rejects_before_deadline():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent, deadline=FUTURE_DEADLINE)
        _fund(rein, vm, principal, amount=250)

        vm.sender = principal
        with vm.expect_revert("has not passed yet"):
            rein.expire_mandate()


def test_expire_mandate_requires_funded_bond():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent, deadline=PAST_DEADLINE)

        vm.sender = principal
        with vm.expect_revert("No bond has been funded"):
            rein.expire_mandate()


def test_expire_mandate_rejects_after_halt():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent, deadline=PAST_DEADLINE, spend_cap=100)
        _fund(rein, vm, principal, amount=250)

        vm.sender = agent
        action_id = rein.submit_action("Try to overspend.", 500, [])
        rein.adjudicate(action_id)  # deterministic overspend VIOLATION, halts + settles
        assert rein.is_halted() is True

        with vm.expect_revert("Already halted"):
            rein.expire_mandate()


def test_expire_mandate_cannot_be_called_twice():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent, deadline=PAST_DEADLINE)
        _fund(rein, vm, principal, amount=250)

        vm.sender = principal
        rein.expire_mandate()
        with vm.expect_revert("already been settled"):
            rein.expire_mandate()
