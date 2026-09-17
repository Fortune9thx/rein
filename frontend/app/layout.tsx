import type { Metadata } from "next";
import { Anton, Inter, IBM_Plex_Mono } from "next/font/google";
import "../styles/globals.css";
import { Providers } from "@/components/Providers";
import { AppNav } from "@/components/AppNav";
import { Footer } from "@/components/Footer";

const anton = Anton({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "REIN — the agent has the keys",
  description:
    "REIN is the mandate, the cap, and the kill switch. A principal posts a natural-language job, cap, deadline, and bond for an agent that already holds its own keys. GenLayer judges every action against the mandate and writes IN_MANDATE, DRIFT, or VIOLATION -- flipping a sticky kill switch and slashing the bond on the first violation.",
};

// Every route depends on client-side wallet state (RainbowKit/wagmi) --
// nothing meaningful to statically prerender, and getDefaultConfig throws
// at module-init time without a real WalletConnect projectId.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${anton.variable} ${inter.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-bg text-fg-body">
        <Providers>
          <AppNav />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
