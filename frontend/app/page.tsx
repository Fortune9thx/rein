import Link from "next/link";
import { TapeBand } from "@/components/TapeBand";

export default function LandingPage() {
  return (
    <div>
      <TapeBand />
      <section className="relative px-6 py-24 md:py-36 max-w-5xl mx-auto">
        <h1 className="font-display text-6xl md:text-8xl text-yellow mb-8 leading-none">
          THE AGENT
          <br />
          HAS THE KEYS.
        </h1>
        <p className="text-fg-body text-lg md:text-xl max-w-xl mb-10">
          REIN is the mandate, the cap, and the kill switch. GenLayer is the jury.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link href="/create" className="btn-tape">
            Open a Rein
          </Link>
          <Link href="/reins" className="btn-tape-outline">
            View archive
          </Link>
        </div>
      </section>

      <TapeBand diagonal />

      <section className="px-6 py-20 max-w-5xl mx-auto grid md:grid-cols-3 gap-10">
        <div>
          <span className="archive-index">01</span>
          <h2 className="font-display text-2xl text-yellow mt-2 mb-3">Post the mandate</h2>
          <p className="text-fg-muted text-sm">
            Write the job in plain language. Set a spend cap, a deadline, and a bond. Bind an agent
            address -- the agent keeps its own keys, always.
          </p>
        </div>
        <div>
          <span className="archive-index">02</span>
          <h2 className="font-display text-2xl text-yellow mt-2 mb-3">Submit the action</h2>
          <p className="text-fg-muted text-sm">
            Anyone -- principal, agent, or watcher -- submits a proposed or observed action with
            live evidence URLs.
          </p>
        </div>
        <div>
          <span className="archive-index">03</span>
          <h2 className="font-display text-2xl text-yellow mt-2 mb-3">GenLayer adjudicates</h2>
          <p className="text-fg-muted text-sm">
            Validators fetch the evidence live and judge the action against the mandate as written.
            IN_MANDATE, DRIFT, or VIOLATION -- with a sticky kill switch and a slashed bond on the
            first violation.
          </p>
        </div>
      </section>

      <section className="px-6 py-20 max-w-3xl mx-auto border-t border-border">
        <p className="font-mono text-xs uppercase tracking-widest text-yellow mb-3">
          Not escrow. Not a market.
        </p>
        <p className="text-fg-body text-lg">
          LEASH stored the job. <span className="text-yellow">REIN judges actions against the job</span>{" "}
          and changes what the world should honor. Halt and remaining cap are public -- any wallet or
          agent runtime can check them before honoring the next spend.
        </p>
      </section>
    </div>
  );
}
