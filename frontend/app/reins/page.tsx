"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getReadOnlyClient, readContractRetry, describeReadError } from "@/lib/genlayer";
import {
  REIN_FACTORY_ADDRESS,
  FACTORY_NOT_CONFIGURED_MESSAGE,
  isFactoryConfigured,
  type ReinMeta,
  type ReinStatus,
} from "@/lib/contracts";

interface Row {
  meta: ReinMeta;
  status: ReinStatus | null;
}

export default function ReinsArchivePage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFactoryConfigured()) {
      setError(FACTORY_NOT_CONFIGURED_MESSAGE);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const client = getReadOnlyClient();
        const addresses = (await readContractRetry(() =>
          client.readContract({ address: REIN_FACTORY_ADDRESS, functionName: "get_reins", args: [] })
        )) as unknown as string[];

        const loaded: Row[] = await Promise.all(
          addresses.map(async (addr) => {
            const meta = (await readContractRetry(() =>
              client.readContract({ address: REIN_FACTORY_ADDRESS, functionName: "get_rein", args: [addr] })
            )) as unknown as ReinMeta;
            let status: ReinStatus | null = null;
            try {
              status = (await readContractRetry(() =>
                client.readContract({ address: addr as `0x${string}`, functionName: "get_status", args: [] })
              )) as unknown as ReinStatus;
            } catch {
              status = null;
            }
            return { meta, status };
          })
        );

        if (!cancelled) setRows(loaded.reverse());
      } catch (err) {
        if (!cancelled) setError(describeReadError(err));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <h1 className="font-display text-5xl text-yellow mb-2">REINS</h1>
      <p className="font-mono text-xs uppercase tracking-widest text-fg-muted mb-10">
        Archive — select an issue
      </p>

      {error && <p className="text-yellow font-mono text-sm">{error}</p>}
      {!rows && !error && (
        <div className="space-y-4">
          <div className="tick-rule" />
          <p className="font-mono text-xs uppercase tracking-widest text-fg-muted">Loading registry…</p>
        </div>
      )}
      {rows && rows.length === 0 && (
        <p className="font-mono text-sm text-fg-muted">No Reins opened yet.</p>
      )}

      {rows &&
        rows.map((row, i) => (
          <Link key={row.meta.address} href={`/rein/${row.meta.address}`} className="archive-row hover:bg-surface transition-colors block">
            <span className="archive-index">{String(rows.length - i).padStart(2, "0")}</span>
            <div>
              <p className="font-display text-xl text-yellow truncate">{row.meta.mandate}</p>
              <p className="font-mono text-xs text-fg-muted">{row.meta.address}</p>
            </div>
            <span className={`stamp ${row.status?.kill_switch ? "stamp--halted" : "stamp--live"}`}>
              {row.status?.kill_switch ? "HALTED" : "LIVE"}
              {row.status ? ` · ${row.status.remaining_cap}` : ""}
            </span>
          </Link>
        ))}
    </div>
  );
}
