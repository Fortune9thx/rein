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

Adjudication uses `gl.eq_principle.prompt_non_comparative(_build_input, task=..., criteria=...)`
— the platform-sanctioned equivalence primitive for "leader executes, validator
independently re-derives and judges faithfulness" — rather than a hand-rolled
`gl.vm.run_nondet(leader, validator)` pair. This is a deliberate choice, not the
first design tried: an earlier version used `run_nondet` with a validator that
only checked the leader's output *shape* (was `verdict` one of the three valid
strings, was `kill_switch` a real boolean). That pattern is a confirmed real
rejection reason on GenLayer's Portal across multiple unrelated projects — a
validator that never independently re-fetches evidence or re-judges the
action can't actually catch a leader that returns a structurally valid but
substantively wrong verdict.

`_build_input()` is the function passed to `prompt_non_comparative`. Critically,
it is called **independently by both the leader and every validator** — each
one re-fetches every evidence URL live via `gl.nondet.web.render`, substituting
`"UNAVAILABLE"` for anything that fails to load, and assembles a JSON string
containing the mandate, cap/deadline context, the action under review, and the
freshly-fetched evidence. That JSON string is the `task`/`criteria` primitive's
"input" — GenVM's own `EqNonComparativeLeader`/`EqNonComparativeValidator`
protocol path handles asking the model to perform `task` on that input against
`criteria`, and reconciling leader vs. validator agreement, entirely inside the
platform's own consensus mechanism rather than in application code.

`task` describes the judgment (classify the action as `IN_MANDATE`/`DRIFT`/
`VIOLATION` using the live evidence as data, never as instructions). `criteria`
pins down the exact required JSON schema: `verdict`, `confidence` (a quoted
decimal string, never a bare float — GenVM calldata has no float type),
`reason`, `recommended_remaining_cap`, `kill_switch`. The agreed text returned
is parsed as JSON in ordinary deterministic code afterward, with every field
coerced and clamped defensively — an out-of-range verdict string, a
non-boolean `kill_switch`, or a `recommended_remaining_cap` larger than the
pre-action remaining cap are all corrected before they ever reach storage.

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

## Step 4 — the liveness escape hatch (`expire_mandate`)

`_settle_bond()` only ever fires on a VIOLATION. Without a separate path, a
well-behaved agent that never violates its mandate would leave the
principal's bond permanently stranded in the contract once the deadline
passes uneventfully — there would be no way to ever get it back. `expire_mandate()`
closes this: it is permissionless, callable by anyone once `now > deadline_ts`,
requires the bond is funded and not yet settled, and requires the Rein is not
already halted (if it is, the bond was already settled on violation). It sets
`settled = true` and pays the bond back to the principal — the exact same
`settled` guard `_settle_bond()` uses, so whichever path fires first makes the
other a safe no-op, and it never sets `kill_switch`, since expiring with no
recorded violation is not itself a violation.

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
