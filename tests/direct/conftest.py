"""
Direct-mode test fixtures for REIN contracts.

Applies one Windows-only monkeypatch documented from prior GenLayer projects
on this machine: gltest's direct-mode loader unlinks a temp file that is
still open via os.dup2 on this platform, raising PermissionError (harmless
on POSIX, where the same test suite runs clean). This patch never touches
contract code or the real SDK -- it only relaxes cleanup of a test-harness
temp file.
"""

import os
import sys
from pathlib import Path

import pytest

CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"
REIN_PATH = CONTRACTS_DIR / "Rein.py"
REIN_FACTORY_PATH = CONTRACTS_DIR / "ReinFactory.py"

_real_unlink = os.unlink


def _safe_unlink(path, *args, **kwargs):
    try:
        _real_unlink(path, *args, **kwargs)
    except PermissionError:
        pass


os.unlink = _safe_unlink


def _patch_exec_prompt_template():
    """The installed gltest build's WASI mock (direct/wasi_mock.py's
    _handle_gl_call) has no case at all for "ExecPromptTemplate" -- the
    gl_call request type gl.eq_principle.prompt_non_comparative's real SDK
    implementation issues internally (a different request shape than the
    plain "ExecPrompt" gl.nondet.exec_prompt uses, which the mock DOES
    handle). Unpatched, every prompt_non_comparative call in direct-mode
    falls through to "Unknown gl_call request type" -> returns None ->
    the SDK's own leader_fn raises NondetException("non-comparative result
    is not text"). This patches in a handler that builds a single
    matchable "prompt" string from template/task/criteria/input, reuses
    the vm's existing _match_llm_mock so tests register mocks exactly the
    same way they already do for plain exec_prompt (vm.mock_llm(pattern,
    response)), and falls back to echoing the input back verbatim if no
    mock matches (mirroring the documented default: a well-formed input
    should survive an equivalence check). Scoped to this test session only
    -- never touches the contract or the real SDK."""
    from gltest.direct import wasi_mock

    _real_handle_gl_call = wasi_mock._handle_gl_call

    def _patched_handle_gl_call(vm, request):
        if isinstance(request, dict) and "ExecPromptTemplate" in request:
            data = request["ExecPromptTemplate"]
            prompt = f"{data.get('template', '')}\n{data.get('task', '')}\n{data.get('criteria', '')}\n{data.get('input', '')}"
            response = vm._match_llm_mock(prompt)
            if response is None:
                response = data.get("input", "")
            return {"ok": response}
        return _real_handle_gl_call(vm, request)

    wasi_mock._handle_gl_call = _patched_handle_gl_call


_patch_exec_prompt_template()


@pytest.fixture
def rein_source() -> str:
    return REIN_PATH.read_text(encoding="utf-8")


def _find_real_address_cls():
    """create_test_addresses()/create_address() fall back to plain bytes in
    this environment because `genlayer` isn't on sys.path until a contract
    has actually been deployed once. Address.as_hex is an EIP-55 Keccak256
    checksum, not plain lowercase hex, so a naive fallback silently produces
    the wrong key for every TreeMap[str, str] lookup keyed by an address.
    Import the real Address class straight from the cached SDK so tests key
    addresses exactly the way the contract itself does.

    v0.3.0-specific gotcha, confirmed live: globbing for the OLD SDK layout
    (`genlayer/py/types.py`, a `py` subpackage) matches a STALE cached
    build for an older pinned hash if one exists anywhere under this
    machine's cache root -- inserting its parent onto sys.path and
    importing from it caches the WRONG `genlayer` top-level package in
    sys.modules for the rest of the process (module imports are cached by
    name, process-wide), so every LATER `import genlayer` inside the real
    v0.3.0 contract deploy silently reuses that stale module and fails
    with `ModuleNotFoundError: No module named 'genlayer.types'` -- a
    confusing failure that looks like a gltest/SDK bug but is actually
    this glob matching the wrong SDK generation. Fixed to glob for the
    real v0.3.0 layout (`genlayer/types.py`, top-level, no `py`
    subpackage) instead."""
    cache_root = Path.home() / ".cache" / "gltest-direct" / "extracted"
    for candidate in cache_root.glob("**/genlayer/types.py"):
        sdk_root = candidate.parents[1]
        if str(sdk_root) not in sys.path:
            sys.path.insert(0, str(sdk_root))
        from genlayer.types import Address
        return Address
    return None


_AddressCls = None


def to_hex(addr) -> str:
    """Normalize a create_test_addresses()/create_address() value (real
    Address or raw bytes fallback) to the exact checksummed 0x-hex string
    the contract's own `gl.message.sender_address.as_hex` produces."""
    if hasattr(addr, "as_hex"):
        return addr.as_hex
    global _AddressCls
    if _AddressCls is None:
        _AddressCls = _find_real_address_cls()
    if _AddressCls is not None:
        return _AddressCls(addr).as_hex
    return "0x" + addr.hex()
