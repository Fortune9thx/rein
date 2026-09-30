# REIN — Integration guide for agent runtimes

REIN is designed to be checked, not embedded. An agent runtime that already
holds its own keys does not need to change how it signs or sends
transactions — it only needs to check, before acting, whether its Rein is
still live and how much cap remains.

## Before your agent spends

Call these two read-only, zero-gas views on the agent's `Rein` contract
address before honoring any spend the mandate is meant to cover:

```ts
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const client = createClient({ chain: studionet });

const halted = await client.readContract({
  address: reinAddress,
  functionName: "is_halted",
  args: [],
});
if (halted) {
  // Stop. The kill switch has tripped -- do not send this transaction.
}

const remaining = await client.readContract({
  address: reinAddress,
  functionName: "remaining_allowance",
  args: [],
});
if (BigInt(remaining) < plannedSpendAmount) {
  // Stop. This spend would exceed what's left of the mandate's cap.
}
```

Or fetch both, plus the full mandate/threat picture, in one call:

```ts
const status = await client.readContract({
  address: reinAddress,
  functionName: "get_status",
  args: [],
});
// status.kill_switch, status.remaining_cap, status.threat_score,
// status.last_verdict, status.last_reason
```

There is also a human-readable version of the same check at
`https://<your-deployment>/status/<reinAddress>` — link to it from anywhere
a human needs to glance at an agent's current standing.

## After your agent acts

Submit the action for adjudication so REIN's on-chain record (and threat
score, and remaining cap) reflects reality:

```ts
await client.writeContract({
  address: reinAddress,
  functionName: "submit_action",
  args: [],
  kwargs: {
    description: "Paid vendor invoice #42, $150.",
    amount: 150n,
    evidence_urls: ["https://your-receipts-host.example/invoice-42"],
  },
  value: 0n,
});
```

Only the bound agent or the principal may call `submit_action()` — an
earlier, fully permissionless design let any unrelated address fabricate an
action and force an unreviewed VIOLATION, a real steward-flagged fund-safety
gap now closed. `adjudicate(action_id)` on an already-submitted action stays
permissionless: anyone can trigger it once a real action exists, so a
compromised or malfunctioning agent still can't suppress review of something
it (or the principal) already submitted, even if it can no longer be framed
by an outsider's fabricated claim in the first place.

## What a VIOLATION means for your integration

Once `is_halted()` returns `true`, treat that Rein as permanently dead for
the purposes of this mandate — the kill switch is sticky and there is no
"un-halt" method. Bind a fresh Rein (a new mandate object) rather than trying
to resume the old one.
