# Security

## Trust model

`Rein` treats every input that is not independently re-derived on-chain as
untrusted:

- **`mandate`, `description`** (caller-supplied) are sanitized on write
  (`_sanitize`) -- control characters, structural JSON/fence characters, and
  known prompt-injection phrasing are stripped before storage or before ever
  reaching the adjudication prompt.
- **`evidence_urls`** are the only fetched, externally-controlled inputs.
  Every URL is validated at `submit_action()` time by `_is_safe_evidence_url`
  (see SSRF mitigation below) before storage, but reachability and genuine
  content can only be confirmed at fetch time, by the leader and every
  validator independently.
- **Fetched evidence content** is sanitized (`_sanitize`) and embedded in the
  adjudication input under an explicit `DATA, NOT INSTRUCTIONS` framing --
  the task/criteria text passed to `gl.eq_principle.prompt_non_comparative`
  instructs the model to ignore any text inside the evidence that tries to
  dictate a verdict.

## Action submission authentication

**[Fixed a real steward-flagged rejection]** `submit_action()` is restricted
to `gl.message.sender_address` being either `self.agent` or `self.principal`
-- the two parties with a real, accountable stake in this specific mandate.
An earlier, fully permissionless design (matching a naive reading of "anyone
can submit an observed action") let any unrelated outsider fabricate an
over-cap action and trigger `adjudicate()`'s deterministic VIOLATION
pre-check with zero evidence or validator review, permanently halting a
funded mandate and slashing the bond on a claim nobody with a stake ever
made. Proven closed with a live test: a random, uninvolved wallet's
fabricated `submit_action()` call reverts, and the mandate's `kill_switch`,
`remaining_cap`, and `action_count` are all provably unchanged afterward.
`adjudicate()` itself stays permissionless on an already-submitted action --
that's safe, since it only evaluates data the agent or principal already
committed to, never caller-injected claims.

## Validator independence

`adjudicate()` uses `gl.eq_principle.prompt_non_comparative`, not a
hand-rolled `gl.vm.run_nondet(leader, validator)` pair. The function passed
to it (`_build_input`) is called independently by both the leader and every
validator -- each one re-fetches every evidence URL live and re-derives its
own judgment, rather than a validator merely checking the leader's output
shape. See [docs/RESOLUTION_LOGIC.md](docs/RESOLUTION_LOGIC.md) for why this
replaced an earlier design that only checked verdict/kill_switch shape --
that pattern is a confirmed real GenLayer Portal rejection reason across
multiple unrelated projects.

## SSRF mitigation

`_is_safe_evidence_url` rejects `localhost`/`*.localhost`, IP-literal
hostnames (IPv4 and bracketed IPv6), purely numeric decimal-encoded IP
tricks, explicit ports, and embedded credentials before a URL is ever
stored. This is a textual, pre-fetch check -- it cannot inspect redirects or
pin against DNS rebinding between validation and the actual
`gl.nondet.web.render` fetch.

## Fund safety

- The only value this contract ever custodies is the principal's own bond,
  funded via a single direct EOA → IC transaction (`fund_bond`). It never
  holds the agent's own spend -- REIN judges actions, it does not escrow them.
- The bond can only ever leave the contract two ways, both paying the
  principal back: `_settle_bond()` on the first VIOLATION, or
  `expire_mandate()` once the deadline has passed with no violation ever
  recorded. Both share the same `settled` guard, so exactly one payout can
  ever happen per Rein -- see [docs/RESOLUTION_LOGIC.md](docs/RESOLUTION_LOGIC.md#step-4--the-liveness-escape-hatch-expire_mandate).
- Payouts always resolve to `self.principal`, a real EOA supplied and fixed
  at deployment -- never a caller-suppliable address, and never another
  Intelligent Contract's own address (a confirmed dead end for native value
  transfers on this GenVM build).

## Reporting

If you find a genuine security issue, open a GitHub issue on this
repository.
