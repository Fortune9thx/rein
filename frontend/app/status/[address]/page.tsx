"use client";

import { use, useEffect, useState } from "react";
import { getReadOnlyClient, readContractRetry, describeReadError } from "@/lib/genlayer";
import type { ReinStatus } from "@/lib/contracts";

/**
 * Public integrator page -- only status, halt flag, and remaining cap.
 * Designed to be linked from other agent tools/wallets so they can check
 * halt + remaining cap before honoring the agent's next spend.
 */
export default function StatusPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const [status, setStatus] = useState<ReinStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const client = getReadOnlyClient();
        const s = (await readContractRetry(() =>
          client.readContract({ address: address as `0x${string}`, functionName: "get_status", args: [] })
        )) as unknown as ReinStatus;
        if (!cancelled) setStatus(s);
      } catch (err) {
        if (!cancelled) setError(describeReadError(err));
      }
    }
    load();
    const interval = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address]);

  return (
    <div className="max-w-lg mx-auto px-6 py-24 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-fg-muted mb-4">Public status</p>
      <p className="font-mono text-xs text-fg-muted mb-10 break-all">{address}</p>

      {error && <p className="text-yellow font-mono text-sm">{error}</p>}

      {status && (
        <>
          <span className={`stamp ${status.kill_switch ? "stamp--halted" : "stamp--live"} text-2xl mb-8`}>
            {status.kill_switch ? "HALTED" : "LIVE"}
          </span>
          <div className="mt-10">
            <p className="field-label mb-2">Remaining cap</p>
            <p className="font-display text-6xl text-yellow">{status.remaining_cap}</p>
          </div>
        </>
      )}

      {!status && !error && (
        <div className="mt-10">
          <div className="tick-rule" />
          <p className="font-mono text-xs uppercase tracking-widest text-fg-muted mt-4">Checking…</p>
        </div>
      )}
    </div>
  );
}
