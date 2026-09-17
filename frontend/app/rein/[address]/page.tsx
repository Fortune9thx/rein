"use client";

import { useCallback, useEffect, useState } from "react";
import { use } from "react";
import {
  getReadOnlyClient,
  pollConsensusStatus,
  describeTransactionOutcome,
  describeReadError,
  useGenLayerClient,
  readContractRetry,
} from "@/lib/genlayer";
import type { ReinAction, ReinStatus, Verdict } from "@/lib/contracts";
import { TransactionStatus } from "genlayer-js/types";
import { VerdictOverlay } from "@/components/VerdictOverlay";

type Stage = "idle" | "sign" | "pending" | "accepted" | "finalized" | "error";

const STAGE_LABEL: Record<Stage, string> = {
  idle: "",
  sign: "SIGN",
  pending: "PENDING",
  accepted: "ACCEPTED",
  finalized: "FINALIZED",
  error: "ERROR",
};

export default function ReinDetailPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const { client } = useGenLayerClient();

  const [status, setStatus] = useState<ReinStatus | null>(null);
  const [actions, setActions] = useState<ReinAction[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [urls, setUrls] = useState("");
  const [submitStage, setSubmitStage] = useState<Stage>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [adjudicatingId, setAdjudicatingId] = useState<number | null>(null);
  const [adjudicateStage, setAdjudicateStage] = useState<Stage>("idle");
  const [overlayVerdict, setOverlayVerdict] = useState<Verdict | null>(null);

  const refresh = useCallback(async () => {
    try {
      const readClient = getReadOnlyClient();
      const s = (await readContractRetry(() =>
        readClient.readContract({ address: address as `0x${string}`, functionName: "get_status", args: [] })
      )) as unknown as ReinStatus;
      setStatus(s);

      const count = Number(s.action_count);
      const loaded: ReinAction[] = [];
      for (let i = 0; i < count; i++) {
        const a = (await readContractRetry(() =>
          readClient.readContract({ address: address as `0x${string}`, functionName: "get_action", args: [i] })
        )) as unknown as ReinAction;
        loaded.push(a);
      }
      setActions(loaded.reverse());
    } catch (err) {
      setLoadError(describeReadError(err));
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSubmitAction() {
    if (!client) return;
    setSubmitError(null);
    setSubmitStage("sign");
    try {
      const urlList = urls
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean);

      const hash = await client.writeContract({
        address: address as `0x${string}`,
        functionName: "submit_action",
        args: [],
        kwargs: { description, amount: BigInt(Math.floor(Number(amount))), evidence_urls: urlList },
        value: 0n,
      });
      setSubmitStage("pending");
      const tx = await pollConsensusStatus(
        client,
        hash,
        (tick) => {
          if (tick.status === TransactionStatus.ACCEPTED) setSubmitStage("accepted");
        },
        { requireFinalized: true }
      );
      setSubmitStage("finalized");
      const outcome = describeTransactionOutcome(tx);
      if (!outcome.succeeded) {
        setSubmitError(outcome.reason ?? "Transaction failed.");
        setSubmitStage("error");
        return;
      }
      setDescription("");
      setAmount("");
      setUrls("");
      setSubmitStage("idle");
      await refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitStage("error");
    }
  }

  async function handleAdjudicate(actionId: number) {
    if (!client) return;
    setAdjudicatingId(actionId);
    setAdjudicateStage("sign");
    try {
      const hash = await client.writeContract({
        address: address as `0x${string}`,
        functionName: "adjudicate",
        args: [],
        kwargs: { action_id: BigInt(actionId) },
        value: 0n,
      });
      setAdjudicateStage("pending");
      const tx = await pollConsensusStatus(
        client,
        hash,
        (tick) => {
          if (tick.status === TransactionStatus.ACCEPTED) setAdjudicateStage("accepted");
        },
        { requireFinalized: true }
      );
      setAdjudicateStage("finalized");
      const outcome = describeTransactionOutcome(tx);
      await refresh();
      if (outcome.succeeded) {
        const refreshed = await getReadOnlyClient().readContract({
          address: address as `0x${string}`,
          functionName: "get_action",
          args: [actionId],
        });
        setOverlayVerdict((refreshed as unknown as ReinAction).verdict);
      }
      setAdjudicateStage("idle");
      setAdjudicatingId(null);
    } catch (err) {
      setAdjudicateStage("error");
      setAdjudicatingId(null);
      setLoadError(err instanceof Error ? err.message : "Adjudication failed.");
    }
  }

  if (loadError && !status) {
    return <p className="max-w-4xl mx-auto px-6 py-16 text-yellow font-mono">{loadError}</p>;
  }

  if (!status) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="tick-rule" />
        <p className="font-mono text-xs uppercase tracking-widest text-fg-muted mt-4">Loading mandate…</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <VerdictOverlay verdict={overlayVerdict} onClose={() => setOverlayVerdict(null)} />

      <div className="flex items-start justify-between gap-4 mb-6">
        <span className={`stamp ${status.kill_switch ? "stamp--halted" : "stamp--live"}`}>
          {status.kill_switch ? "HALTED" : "LIVE"}
        </span>
        <span className="font-mono text-xs text-fg-muted">{address}</span>
      </div>

      <h1 className="font-display text-3xl md:text-5xl text-yellow mb-8 leading-tight">{status.mandate}</h1>

      <div className="grid grid-cols-3 gap-4 mb-10 hairline pb-6">
        <div>
          <p className="field-label mb-1">Remaining cap</p>
          <p className="font-display text-3xl text-yellow">{status.remaining_cap}</p>
        </div>
        <div>
          <p className="field-label mb-1">Threat score</p>
          <p className="font-display text-3xl text-yellow">{status.threat_score}</p>
        </div>
        <div>
          <p className="field-label mb-1">Bond</p>
          <p className="font-display text-3xl text-yellow">
            {status.bond_funded ? status.bond_amount : "unfunded"}
          </p>
        </div>
      </div>

      {status.last_verdict && (
        <div className="mb-10 font-mono text-sm text-fg-muted">
          <span className="text-yellow">{status.last_verdict}</span> ({status.last_confidence}) — {status.last_reason}
        </div>
      )}

      {!status.kill_switch && (
        <div className="mb-14 border border-border p-6">
          <h2 className="font-display text-xl text-yellow mb-4">SUBMIT ACTION</h2>
          <div className="space-y-4">
            <div>
              <label className="field-label">Description</label>
              <input className="field-input mt-2" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Amount</label>
              <input className="field-input mt-2" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Evidence URLs (one per line)</label>
              <textarea className="field-input mt-2 h-20" value={urls} onChange={(e) => setUrls(e.target.value)} />
            </div>
            <button
              className="btn-tape"
              disabled={!client || !description || !amount || (submitStage !== "idle" && submitStage !== "error")}
              onClick={handleSubmitAction}
            >
              {submitStage === "idle" || submitStage === "error" ? "Submit Action" : STAGE_LABEL[submitStage]}
            </button>
            {submitStage !== "idle" && submitStage !== "error" && <div className="tick-rule" />}
            {submitError && <p className="text-yellow font-mono text-sm">{submitError}</p>}
          </div>
        </div>
      )}

      <h2 className="font-display text-xl text-yellow mb-4">ACTIONS</h2>
      <div className="space-y-4">
        {actions.length === 0 && <p className="font-mono text-sm text-fg-muted">No actions submitted yet.</p>}
        {actions.map((a) => (
          <div key={a.id} className="border border-border p-5">
            <div className="flex items-center justify-between gap-4 mb-2">
              <p className="font-display text-lg text-yellow">#{a.id} — {a.description}</p>
              <span className="font-mono text-xs text-fg-muted uppercase">{a.verdict}</span>
            </div>
            <p className="font-mono text-xs text-fg-muted mb-2">Amount: {a.amount}</p>
            {a.evidence_urls.length > 0 && (
              <ul className="font-mono text-xs text-fg-muted mb-2 list-disc list-inside">
                {a.evidence_urls.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            )}
            {a.reason && <p className="font-mono text-xs text-fg-muted mb-3">{a.reason}</p>}
            {a.verdict === "PENDING" && (
              <button
                className="btn-tape-outline"
                disabled={!client || adjudicatingId === a.id}
                onClick={() => handleAdjudicate(a.id)}
              >
                {adjudicatingId === a.id ? `JURY IN SESSION — ${STAGE_LABEL[adjudicateStage]}` : "Adjudicate"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
