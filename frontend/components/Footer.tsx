import { TapeBand } from "@/components/TapeBand";

export function Footer() {
  return (
    <footer className="mt-24">
      <TapeBand diagonal />
      <div className="px-6 py-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-t border-border">
        <p className="font-mono text-xs uppercase tracking-widest text-fg-muted">
          REIN — the contract is the leash.
        </p>
        <p className="font-mono text-xs text-fg-muted">Not custody. Not a market.</p>
      </div>
    </footer>
  );
}
