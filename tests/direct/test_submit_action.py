"""Direct-mode tests for Rein.fund_bond() and Rein.submit_action()."""

from gltest.direct import VMContext, deploy_contract, create_test_addresses

from conftest import REIN_PATH, to_hex

FUTURE_DEADLINE = "2099-01-01T00:00:00Z"


def _deploy(vm, principal, agent, mandate="Pay the invoice at most once.", spend_cap=1000, deadline=FUTURE_DEADLINE):
    vm.sender = principal
    return deploy_contract(REIN_PATH, vm, to_hex(principal), to_hex(agent), mandate, spend_cap, deadline)


def _fund(rein, vm, principal, amount=100):
    vm.sender = principal
    vm.value = amount
    rein.fund_bond()


def test_fund_bond_requires_principal():
    vm = VMContext()
    principal, agent, outsider = create_test_addresses(3)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        vm.sender = outsider
        vm.value = 100
        with vm.expect_revert("Only the principal"):
            rein.fund_bond()


def test_fund_bond_requires_positive_value():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        vm.sender = principal
        vm.value = 0
        with vm.expect_revert("positive value"):
            rein.fund_bond()


def test_fund_bond_cannot_be_repeated():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        with vm.expect_revert("already funded"):
            _fund(rein, vm, principal, 50)


def test_fund_bond_sets_status():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 250)
        status = rein.get_status()
        assert status["bond_funded"] is True
        assert status["bond_amount"] == "250"


def test_submit_action_requires_funded_bond():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        vm.sender = agent
        with vm.expect_revert("bond has not been funded"):
            rein.submit_action("Buy groceries.", 50, [])


def test_submit_action_records_pending_action():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        vm.sender = agent
        action_id = rein.submit_action("Buy office supplies.", 50, ["https://example.com/receipt"])
        assert action_id == 0
        record = rein.get_action(0)
        assert record["verdict"] == "PENDING"
        assert record["amount"] == 50
        assert record["description"] == "Buy office supplies."
        assert rein.get_actions_count() == 1


def test_submit_action_rejects_non_http_evidence():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        vm.sender = agent
        with vm.expect_revert("http(s) URL"):
            rein.submit_action("Buy supplies.", 50, ["ftp://example.com/receipt"])


def test_submit_action_rejects_too_many_urls():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        vm.sender = agent
        urls = [f"https://example.com/{i}" for i in range(6)]
        with vm.expect_revert("At most"):
            rein.submit_action("Buy supplies.", 50, urls)


def test_submit_action_rejects_empty_description():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        vm.sender = agent
        with vm.expect_revert("description is required"):
            rein.submit_action("", 50, [])


def test_submit_action_ids_increment():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        vm.sender = agent
        first = rein.submit_action("First.", 10, [])
        second = rein.submit_action("Second.", 10, [])
        assert first == 0
        assert second == 1
