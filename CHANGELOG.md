# Changelog

## 2026-09-30 — Steward rejection appeal

**Rejection**: "We cannot accept this submission because any outsider can
submit an unauthenticated over-cap action and permanently halt a funded
mandate without evidence or validator review. Bind submitted actions to the
configured agent or an independently verifiable transaction before allowing
them to trigger violation and settlement."

- **Fixed**: `submit_action()` now requires `gl.message.sender_address` to
  be either the bound agent or the principal. Previously anyone could call
  it, including for a fabricated, wildly over-cap action that tripped
  `adjudicate()`'s deterministic VIOLATION pre-check with zero evidence or
  validator involvement.
- Added two direct-mode tests proving the fix: an outsider's submission
  reverts and leaves `kill_switch`/`remaining_cap`/`action_count` completely
  unchanged; the principal (not just the agent) can still legitimately
  submit. 40/40 direct-mode tests pass.
- Updated README/INTEGRATION.md's "anyone can submit" claims, which were
  the original (now-rejected) design intent, to describe the fixed
  behavior.
- Redeployed `ReinFactory` to `0x266ABC530E379856D7cB5bb1a74aE52D9CAD3743`
  and proved the fix live: a real, random, previously-uninvolved wallet's
  fabricated over-cap `submit_action()` call was rejected on-chain
  (`FINISHED_WITH_ERROR`), the mandate was provably untouched, and a
  legitimate principal-submitted action still adjudicated normally through
  the real jury (`IN_MANDATE`, confidence 0.97).

## 2026-09-17 — Pre-submission audit pass

- **Redesigned `adjudicate()`'s validator around `gl.eq_principle.prompt_non_comparative`**,
  replacing a hand-rolled `gl.vm.run_nondet(leader, validator)` pair whose
  validator only checked output shape (verdict in the valid set, `kill_switch`
  a boolean) without independently re-fetching evidence or re-judging. The
  new design's leader/validator both call the same evidence-fetching
  function independently, matching the platform-sanctioned pattern for
  faithfulness checking.
- **Added `expire_mandate()`**, a permissionless liveness escape hatch.
  `_settle_bond()` only ever fired on VIOLATION, so a mandate that expired
  with no violation ever recorded had no way to return the principal's bond.
- **Added real SSRF protection** on evidence URLs (`_is_safe_evidence_url`):
  reject localhost, literal/numeric-encoded IPs, embedded credentials, and
  explicit ports, replacing a bare `http(s)://` prefix check.
- **Added `_extract_json_object()`** to defensively parse the adjudication
  model's output -- real LLM output is not guaranteed to be bare JSON even
  when instructed to be; a naive `json.loads()` on prose-wrapped output was
  silently coercing every such response to VIOLATION.
- **Frontend**: `/reins` archive page now uses `Promise.allSettled` instead
  of `Promise.all`, so one not-yet-finalized sibling Rein can no longer blank
  every other already-ready row.
- **Test infrastructure**: fixed a stale SDK-layout glob in
  `tests/direct/conftest.py` that was silently poisoning Python's module
  cache and breaking every direct-mode deploy; added the required
  `ExecPromptTemplate` mock patch for `gltest`'s WASI mock. Direct-mode
  tests now run and pass: 38/38.
- Redeployed `ReinFactory` to `0x0B045FF6AeA802AF611856386Ad953477Ae84d50`
  and re-verified the full lifecycle live end to end, including a real
  `expire_mandate()` call.

## 2026-09-16 — Initial build

- `Rein.py` / `ReinFactory.py` written against GenLayer's v0.3.0 contract
  API, targeting Studio Devnet ("Studio Next").
- Next.js 15 App Router frontend: landing, create flow, archive, Rein
  detail/adjudication, public status page.
- Deployed `ReinFactory` to `0x53E9d73e05B832F753aEf66aeC7AE0804197A8d8` and
  verified a full create → fund → submit → adjudicate lifecycle live.
