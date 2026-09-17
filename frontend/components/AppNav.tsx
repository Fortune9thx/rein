"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export function AppNav() {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-black sticky top-0 z-40">
      <Link href="/" className="font-display text-2xl text-yellow tracking-tight">
        REIN
      </Link>
      <nav className="hidden md:flex items-center gap-6 font-mono text-xs uppercase tracking-widest text-fg-muted">
        <Link href="/reins" className="hover:text-yellow transition-colors">
          Reins
        </Link>
        <Link href="/create" className="hover:text-yellow transition-colors">
          Open a Rein
        </Link>
      </nav>
      <ConnectButton showBalance={false} chainStatus="icon" />
    </header>
  );
}
