# REIN — Architecture

## The problem

Autonomous agents increasingly hold their own private keys. The principal who
deployed an agent cannot, and often should not, custody its wallet — that
would defeat the point of an autonomous agent in the first place. But that
leaves nothing standing between "the agent is doing its job" and "the agent
just moved money out from under everyone" except whatever guardrails were
hardcoded into the agent's own runtime, which the agent's own bugs, prompt
injection, or a compromised key can bypass entirely.

REIN is a live, on-chain mandate object that sits *outside* the agent's own
code. It does not hold the agent's funds and does not gate the agent's
transactions at the wallet level — it cannot, since the agent keeps its own
keys. What it does is give the world (other contracts, wallets, agent
runtimes, the principal) a place to check, before honoring the agent's next
move, whether that agent is still inside its authorized mandate.

## Not escrow. Not a market.

- **Not escrow.** REIN never holds the funds an agent spends. The only value
  it ever custodies is the principal's own bond, and the only thing that ever
  happens to that bond is a one-time slash back to the principal on the first
  VIOLATION.
- **Not a prediction market.** There is no staking on outcomes, no
  parimutuel pool, no crowd of backers betting on a verdict.
- **Not LEASH with a new coat of paint.** A permission board that just stores
  "here is the job" is a read-only record. REIN's Intelligent Contract
  actively judges every submitted action against that job, using live
  fetched evidence, and changes on-chain state as a result: remaining spend
  cap goes down, threat score goes up, and a sticky kill switch can flip
  permanently. The contract is not a bulletin board — it is the jury.

## Components

- **`ReinFactory.py`** — a permissionless registry + on-chain factory.
  `create_rein()` deploys a fresh `Rein.py` instance per mandate via
  `gl.deploy_contract`, mirroring the verified `genlayerlabs/intelligent-oracle`
  Registry pattern. It is deliberately never payable: the principal bond is
  never routed through the factory.
- **`Rein.py`** — the mandate object itself. Holds the mandate text, spend
  cap, deadline, kill switch, threat score, bond, and the full action log.
  `submit_action()` records a proposed/observed action; `adjudicate()` judges
  it and updates state.

## Why bond funding is a separate transaction

A GenVM Intelligent Contract cannot reliably forward native value to another
contract it just deployed — a factory forwarding `msg.value` into a
freshly-deployed `Rein` would be an IC → IC value transfer, which is a
confirmed dead end on this GenVM build (the value is deducted from the
sender but never delivered, with no rescue path). So `create_rein()` never
carries value. Instead, once the frontend has the new Rein's address, the
principal sends a second, direct EOA → IC transaction — `Rein.fund_bond()` —
which is the well-proven, safe direction for a native value transfer.

## Adjudication

`adjudicate(action_id)` runs two layers of checks:

1. **Deterministic pre-checks** — if the action amount already exceeds the
   remaining cap, or the mandate's deadline has already passed, the action is
   a VIOLATION on its face. No LLM call is needed or made; the kill switch
   trips immediately and cheaply.
2. **The nondet jury** — otherwise, `gl.eq_principle.prompt_non_comparative`
   (the one-nondet-call-per-method rule `genvm-lint` enforces) is called with
   a function that fetches every declared evidence URL live via
   `gl.nondet.web.render` and assembles it, with the mandate and action, into
   a JSON input string. That function runs **independently for both the
   leader and every validator** — each one re-fetches the evidence itself,
   which is what makes the validation genuinely independent rather than a
   structural check on the leader's own output. GenVM's own
   `EqNonComparativeLeader`/`EqNonComparativeValidator` protocol path asks
   the model to classify the action as `IN_MANDATE`, `DRIFT`, or `VIOLATION`
   with a confidence, a reason, a recommended remaining cap, and a
   `kill_switch` boolean, and reconciles leader/validator agreement inside
   the platform's own consensus mechanism. See
   [docs/RESOLUTION_LOGIC.md](RESOLUTION_LOGIC.md) for why this replaced an
   earlier hand-rolled `gl.vm.run_nondet(leader, validator)` design — a
   validator that only checks output shape, without independently
   re-acquiring evidence, is a confirmed real GenLayer Portal rejection
   pattern.

VIOLATION always trips the kill switch and settles the bond, regardless of
what the model returned for `kill_switch` — that flag is model-recommended
but never model-*required* to be true for a VIOLATION's consequences to
apply.

## The liveness escape hatch

`_settle_bond()` only ever fires on VIOLATION. A mandate that simply expires
uneventfully — no violation ever recorded — would otherwise leave the
principal's bond permanently stranded in the contract with no way to recover
it. `expire_mandate()` is a permissionless write, callable by anyone once the
deadline has passed, that returns the bond to the principal without touching
the kill switch (expiring quietly is not a violation). It shares the same
`settled` guard `_settle_bond()` uses, so the two paths can never double-pay.

## What other systems can query

Any wallet, contract, or agent runtime can call, at zero cost:

- `is_halted()` — has the kill switch tripped?
- `remaining_allowance()` — how much spend is still authorized?
- `get_status()` — the full picture: mandate, cap, deadline, threat score,
  bond state, last verdict.

The public `/status/[address]` frontend page exists specifically so another
tool can link to a human-readable version of the same check.
