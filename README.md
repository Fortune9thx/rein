# REIN

**The agent has the keys. REIN is the mandate, the cap, and the kill switch.
GenLayer is the jury.**

REIN is a live mandate object for AI agents that already hold their own
private keys. The principal never custodians the agent's wallet — instead, a
GenLayer Intelligent Contract judges every action the agent proposes or takes
against a natural-language mandate, and changes what the world should honor
as a result: remaining spend cap goes down, threat score goes up, and a
sticky on-chain kill switch can trip permanently, slashing a principal-posted
bond on the first violation.

**LEASH stored the job. REIN judges actions against the job and changes what
the world should honor.** This is not escrow — REIN never holds the funds an
agent spends, only its own bond. It is not a prediction market — there is no
staking on outcomes. It is a live jury with real, on-chain teeth.

## Live

- **App:** https://frontend-gilt-omega-54.vercel.app
- **`ReinFactory`** on GenLayer Studio Devnet ("Studio Next", chain id `61997`):
  `0x0B045FF6AeA802AF611856386Ad953477Ae84d50`
- Full lifecycle (create → fund bond → submit action → adjudicate → expire)
  verified live end to end, including a real `gl.eq_principle.prompt_non_comparative`
  jury call and a real `expire_mandate()` bond return.

## How it works

1. A principal posts a Rein: a mandate, a spend cap, a deadline, and (in a
   second transaction) a bond. An agent address is bound — the agent keeps
   its own keys, always.
2. Anyone — principal, agent, or an independent watcher — submits an action
   packet: description, amount, and evidence URLs.
3. `adjudicate()` runs a deterministic pre-check (is this action already
   over cap or past the deadline?) and, failing that, a live GenLayer jury:
   validators fetch every evidence URL fresh and judge the action against
   the mandate as written.
4. State updates: `IN_MANDATE` decrements the remaining cap, `DRIFT` raises
   the threat score, `VIOLATION` trips the sticky kill switch and slashes the
   bond back to the principal.
5. Any wallet, contract, or agent runtime can check `is_halted()` and
   `remaining_allowance()` before honoring the agent's next spend.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design
rationale, [docs/RESOLUTION_LOGIC.md](docs/RESOLUTION_LOGIC.md) for the exact
adjudication state machine, and [docs/INTEGRATION.md](docs/INTEGRATION.md)
for wiring an agent runtime up to a live Rein.

## Repository layout

```
rein/
├── contracts/          Rein.py, ReinFactory.py -- the Intelligent Contracts
├── tests/direct/       gltest direct-mode tests (WASI mock, no network)
├── tests/integration/  full-lifecycle tests against a live network
├── frontend/           Next.js 15 App Router UI
├── deploy/             deploy.mjs -- one-shot factory deploy script
└── docs/               architecture, resolution logic, integration guide
```

## Running the contracts locally

```bash
pip install genlayer-test genvm-linter python-dotenv
genvm-lint check contracts/Rein.py
genvm-lint check contracts/ReinFactory.py
gltest tests/direct
```

38/38 direct-mode tests pass (creation validation, bond funding, action
submission with SSRF-safe URL checks, all three verdict paths, the
deterministic overspend/deadline short-circuit, and the `expire_mandate()`
liveness escape hatch).

## Deploying

```bash
npm install
PRIVATE_KEY=0x... npm run deploy
```

This deploys `ReinFactory` (with `Rein.py`'s source embedded as its
constructor argument) to GenLayer Studio Next, and writes the resulting
address into both `.env` and `frontend/.env.local`.

## Running the frontend

```bash
cd frontend
npm install
npm run dev
```

## Submission notes (portal blurb)

> REIN is a live mandate object for agents that already hold keys. A
> principal posts a natural-language job, cap, deadline, and bond. Actions
> are submitted with evidence URLs. GenLayer fetches live pages, judges the
> action against the mandate, and writes IN_MANDATE, DRIFT, or VIOLATION.
> Violations flip a sticky kill switch and slash the bond to the principal.
> Wallets and agent runtimes can query halt + remaining cap before honoring
> the next spend. Not custody. Not a market. The contract is the leash.

## License

MIT
