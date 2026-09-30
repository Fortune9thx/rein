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


def test_submit_action_rejects_unauthenticated_outsider():
    """Steward-flagged rejection: an unrelated third party must never be
    able to submit an action at all -- not even a wildly over-cap one meant
    to fabricate a fast, unreviewed VIOLATION and grief a funded mandate
    with no evidence or validator involvement."""
    vm = VMContext()
    principal, agent, outsider = create_test_addresses(3)
    with vm.activate():
        rein = _deploy(vm, principal, agent, spend_cap=100)
        _fund(rein, vm, principal, 100)
        vm.sender = outsider
        with vm.expect_revert("Only the principal or the bound agent"):
            rein.submit_action("Fabricated outsider action.", 10_000, [])
        # And the mandate must be provably untouched by the rejected attempt.
        assert rein.is_halted() is False
        assert rein.get_actions_count() == 0
        assert rein.remaining_allowance() == "100"


def test_submit_action_allows_principal_not_just_agent():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        vm.sender = principal
        action_id = rein.submit_action("Principal-observed action.", 25, [])
        assert action_id == 0


def test_submit_action_rejects_non_http_evidence():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        vm.sender = agent
        with vm.expect_revert("http(s) URL"):
            rein.submit_action("Buy supplies.", 50, ["ftp://example.com/receipt"])


def test_submit_action_rejects_localhost_evidence_url():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        vm.sender = agent
        with vm.expect_revert("http(s) URL"):
            rein.submit_action("Buy supplies.", 50, ["http://localhost/receipt"])
        with vm.expect_revert("http(s) URL"):
            rein.submit_action("Buy supplies.", 50, ["http://sub.localhost/receipt"])


def test_submit_action_rejects_literal_ip_evidence_url():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        vm.sender = agent
        with vm.expect_revert("http(s) URL"):
            rein.submit_action("Buy supplies.", 50, ["http://127.0.0.1/receipt"])
        with vm.expect_revert("http(s) URL"):
            rein.submit_action("Buy supplies.", 50, ["http://[::1]/receipt"])


def test_submit_action_rejects_numeric_encoded_ip_evidence_url():
    """2130706433 is 127.0.0.1 encoded as a plain decimal integer -- a
    classic SSRF bypass for naive hostname allowlists that only check for
    dotted-quad IPv4 literals."""
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        vm.sender = agent
        with vm.expect_revert("http(s) URL"):
            rein.submit_action("Buy supplies.", 50, ["http://2130706433/receipt"])


def test_submit_action_rejects_evidence_url_with_credentials():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        vm.sender = agent
        with vm.expect_revert("http(s) URL"):
            rein.submit_action("Buy supplies.", 50, ["https://user:pass@example.com/receipt"])


def test_submit_action_rejects_evidence_url_with_explicit_port():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        vm.sender = agent
        with vm.expect_revert("http(s) URL"):
            rein.submit_action("Buy supplies.", 50, ["https://example.com:8443/receipt"])


def test_submit_action_accepts_plain_public_https_url():
    vm = VMContext()
    principal, agent = create_test_addresses(2)
    with vm.activate():
        rein = _deploy(vm, principal, agent)
        _fund(rein, vm, principal, 100)
        vm.sender = agent
        action_id = rein.submit_action("Buy supplies.", 50, ["https://example.com/receipt"])
        assert action_id == 0


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
