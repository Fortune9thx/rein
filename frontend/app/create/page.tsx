"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  getReadOnlyClient,
  pollConsensusStatus,
  describeTransactionOutcome,
  useGenLayerClient,
  readContractRetry,
} from "@/lib/genlayer";
import { REIN_FACTORY_ADDRESS, FACTORY_NOT_CONFIGURED_MESSAGE, isFactoryConfigured } from "@/lib/contracts";
import { TransactionStatus } from "genlayer-js/types";

type Stage = "idle" | "sign" | "pending" | "accepted" | "finalized" | "error";

const STAGE_LABEL: Record<Stage, string> = {
  idle: "",
  sign: "SIGN",
  pending: "PENDING",
  accepted: "ACCEPTED",
  finalized: "FINALIZED",
  error: "ERROR",
};

export default function CreatePage() {
  const router = useRouter();
  const { client, address } = useGenLayerClient();
  const [mandate, setMandate] = useState("");
  const [cap, setCap] = useState("");
  const [deadline, setDeadline] = useState("");
  const [agent, setAgent] = useState("");
  const [bond, setBond] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState<string | null>(null);

  const canSubmit =
    mandate.trim().length > 0 &&
    Number(cap) > 0 &&
    deadline.trim().length > 0 &&
    agent.trim().length > 0 &&
    Number(bond) > 0 &&
    !!client &&
    !!address;

  async function handleSubmit() {
    if (!client || !address) return;
    if (!isFactoryConfigured()) {
      setError(FACTORY_NOT_CONFIGURED_MESSAGE);
      setStage("error");
      return;
    }
    setError(null);
    setStage("sign");
    try {
      const deadlineIso = new Date(deadline).toISOString();

      const hash = await client.writeContract({
        address: REIN_FACTORY_ADDRESS,
        functionName: "create_rein",
        args: [],
        kwargs: {
          mandate,
          spend_cap: BigInt(Math.floor(Number(cap))),
          deadline: deadlineIso,
          agent,
        },
        value: 0n,
      });

      setStage("pending");
      const tx = await pollConsensusStatus(
        client,
        hash,
        (tick) => {
          if (tick.status === TransactionStatus.ACCEPTED) setStage("accepted");
        },
        { requireFinalized: true }
      );
      setStage("finalized");

      const outcome = describeTransactionOutcome(tx);
      if (!outcome.succeeded) {
        setError(outcome.reason ?? "Transaction failed.");
        setStage("error");
        return;
      }

      // The write only returns a tx hash -- resolve the new Rein's address
      // by re-reading the factory's own registry for this principal rather
      // than trying to decode a return value off the receipt.
      const readClient = getReadOnlyClient();
      const addresses = await readContractRetry(() =>
        readClient.readContract({
          address: REIN_FACTORY_ADDRESS,
          functionName: "reins_by_principal_address",
          args: [address],
        })
      );
      const list = addresses as unknown as string[];
      const created = list[list.length - 1];
      setNewAddress(created);

      // Fund the bond as a direct principal -> Rein transaction -- this
      // deliberately never routes through the factory (IC -> IC value
      // transfers silently fail to deliver on this GenVM build).
      const bondHash = await client.writeContract({
        address: created as `0x${string}`,
        functionName: "fund_bond",
        args: [],
        kwargs: {},
        value: BigInt(Math.floor(Number(bond))),
      });
      await pollConsensusStatus(client, bondHash, () => {}, { requireFinalized: true });

      router.push(`/rein/${created}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStage("error");
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <h1 className="font-display text-5xl text-yellow mb-2">OPEN A REIN</h1>
      <p className="text-fg-muted text-sm mb-10 font-mono uppercase tracking-widest">
        Step 1 of 1 — the mandate is binding the moment this finalizes.
      </p>

      {!isFactoryConfigured() && (
        <p className="text-yellow font-mono text-xs mb-8 border border-yellow p-3">{FACTORY_NOT_CONFIGURED_MESSAGE}</p>
      )}

      <div className="space-y-6">
        <div>
          <label className="field-label">Mandate</label>
          <textarea
            className="field-input mt-2 h-32"
            placeholder="Pay approved vendor invoices only, up to the cap, before the deadline."
            value={mandate}
            onChange={(e) => setMandate(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label">Spend cap (GEN)</label>
            <input className="field-input mt-2" type="number" min="1" value={cap} onChange={(e) => setCap(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Bond (GEN)</label>
            <input className="field-input mt-2" type="number" min="1" value={bond} onChange={(e) => setBond(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="field-label">Deadline</label>
          <input
            className="field-input mt-2"
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">Agent address</label>
          <input
            className="field-input mt-2 font-mono"
            placeholder="0x..."
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          />
        </div>

        {!address && (
          <p className="text-fg-muted text-sm font-mono">Connect a wallet to open a Rein.</p>
        )}

        <button className="btn-tape w-full" disabled={!canSubmit || (stage !== "idle" && stage !== "error")} onClick={handleSubmit}>
          {stage === "idle" || stage === "error" ? "Open Rein" : STAGE_LABEL[stage]}
        </button>

        {stage !== "idle" && stage !== "error" && (
          <div className="tick-rule" />
        )}

        {error && <p className="text-yellow font-mono text-sm">{error}</p>}
        {newAddress && (
          <p className="text-fg-muted font-mono text-sm">
            Deployed at {newAddress} — funding bond and redirecting…
          </p>
        )}
      </div>
    </div>
  );
}
