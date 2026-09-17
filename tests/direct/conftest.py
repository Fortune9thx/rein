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
    addresses exactly the way the contract itself does."""
    cache_root = Path.home() / ".cache" / "gltest-direct" / "extracted"
    for candidate in cache_root.glob("**/genlayer/py/types.py"):
        sdk_root = candidate.parents[2]
        if str(sdk_root) not in sys.path:
            sys.path.insert(0, str(sdk_root))
        from genlayer.py.types import Address
        return Address
    return None


_AddressCls = None


def warp_now(vm, iso_timestamp: str) -> None:
    """vm.warp() alone does not move a Rein's notion of "now" for a contract
    already deployed -- see genlayer-test-toolchain memory. Patched here,
    scoped to tests only, never touching the contract or the real SDK."""
    vm.warp(iso_timestamp)
    gl = sys.modules.get("genlayer.gl")
    if gl is not None and getattr(gl, "message_raw", None) is not None:
        gl.message_raw["datetime"] = iso_timestamp


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
