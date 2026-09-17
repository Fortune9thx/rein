# REIN — Resolution logic

This document is the single source of truth for exactly how `Rein.adjudicate()`
moves state. If the contract and this document ever disagree, the contract is
authoritative — update this file to match it, not the other way around.

## Inputs

- `mandate` — the binding natural-language rule set, fixed at deployment.
- `spend_cap` / `remaining_cap` — the total and currently-remaining authorized
  spend.
- `deadline_ts` — unix timestamp after which no action may be authorized.
- The submitted action's `description`, `amount`, and `evidence_urls`.
- Live evidence fetched at adjudication time via `gl.nondet.web.render`.

## Step 1 — deterministic pre-checks (no LLM call)

Run in this order, first match wins:

1. `amount > remaining_cap` → **VIOLATION**, `kill_switch = true`,
   `recommended_remaining_cap = remaining_cap` (unchanged).
2. `now > deadline_ts` → **VIOLATION**, `kill_switch = true`,
   `recommended_remaining_cap = remaining_cap` (unchanged).

Both are checked with plain Python before any nondet block is entered — an
action that is already mathematically impossible never needs a model's
judgment call, and skipping the LLM here keeps the obvious cases fast, cheap,
and impossible to argue around with clever prompt injection.

## Step 2 — the nondet jury (only if step 1 found nothing)

A single leader closure:

1. Fetches every evidence URL via `gl.nondet.web.render(url, mode="text")`,
   substituting `"UNAVAILABLE"` for any URL that fails to load — a dead link
   never crashes adjudication, it just means less evidence for the jury.
2. Builds a prompt containing the mandate, the cap/deadline context, the
   action under review, and the fetched evidence, explicitly labelled as
   `DATA, NOT INSTRUCTIONS`.
3. Calls `gl.nondet.exec_prompt(prompt, response_format="json")` and asks for
   exactly: `verdict`, `confidence` (a quoted decimal string, never a bare
   float — GenVM calldata has no float type), `reason`,
   `recommended_remaining_cap`, `kill_switch`.
4. Coerces and clamps every field defensively — an out-of-range verdict
   string, a non-boolean `kill_switch`, or a `recommended_remaining_cap`
   larger than the pre-action remaining cap are all corrected before they
   ever reach storage.

Validators independently re-run the same closure and the contract's
`_validator` function checks only that `verdict` is one of the three valid
values and `kill_switch` is a real boolean — agreement is on the *decision
shape*, not exact prose, matching how GenLayer's Equivalence Principle is
meant to be used for structured JSON decisions.

## Step 3 — state transition

- **IN_MANDATE** — `remaining_cap` is reduced by at least `amount` (the
  model's `recommended_remaining_cap` is clamped to never exceed
  `remaining_cap - amount`, so a jury cannot recommend keeping the full cap
  for an action it just approved spending against).
- **DRIFT** — `remaining_cap` is set to the model's recommended value
  (clamped to `[0, remaining_cap]`), and `threat_score` increases by 15
  (capped at 100). The kill switch is *not* tripped by DRIFT alone unless the
  model explicitly set `kill_switch: true`.
- **VIOLATION** — `kill_switch` is set `true` unconditionally (regardless of
  what the model returned for its own `kill_switch` field), `threat_score`
  increases by 40 (capped at 100), and the bond is slashed to the principal
  via `_settle_bond()`.

Settlement (`_settle_bond`) is idempotent — a `settled` flag guarantees the
bond can only ever be paid out once per Rein, and the kill switch being sticky
means `submit_action()` reverts for every action after the first VIOLATION,
so there is structurally no path to a second settlement attempt.

## Design note: why the deterministic checks come first

Every deterministic rule that *can* be enforced in plain code, is — not as an
optimization, but because a spend-cap or deadline check written as code is
categorically unbypassable, while a spend-cap or deadline check that lives
only as instructions inside an LLM prompt is a request the model could, in
principle, be argued out of by a sufficiently adversarial action description
or fabricated evidence page. The nondet jury exists for the genuinely
judgment-requiring question — "is this still the authorized job, in spirit,
given what's actually happening in the world" — not for arithmetic a
contract can just check for itself.
