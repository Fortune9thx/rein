"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { createClient } from "genlayer-js";
import { studioNext } from "@/lib/chains";
import { TransactionStatus, ExecutionResult } from "genlayer-js/types";
import type {
  GenLayerClient,
  GenLayerChain,
  GenLayerTransaction,
  TransactionHash,
} from "genlayer-js/types";

let _readOnlyClient: GenLayerClient<GenLayerChain> | null = null;

/**
 * A wallet-free client for read-only pages (archive, status page).
 * readContract needs no signer -- never construct this with an account,
 * since createAccount() with no arguments generates a fresh random wallet
 * on every call and triggers wallet permission prompts.
 */
export function getReadOnlyClient(): GenLayerClient<GenLayerChain> {
  if (!_readOnlyClient) {
    _readOnlyClient = createClient({ chain: studioNext });
  }
  return _readOnlyClient;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * GenLayer's gen_call read path has real, confirmed intermittent failures
 * against genuinely valid, deployed contracts. A single-attempt read on
 * first page load is fragile against this -- wrap any read that a write
 * decision depends on in this retry rather than let a transient failure
 * propagate into a fabricated fallback or a stuck loading state forever.
 */
export async function readContractRetry<T>(
  fn: () => Promise<T>,
  {
    attempts = 5,
    intervalMs = 2000,
    timeoutMs = 8000,
  }: { attempts?: number; intervalMs?: number; timeoutMs?: number } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(fn(), timeoutMs);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  }
  throw lastErr;
}

/**
 * Translates the raw viem/genlayer-js RPC error strings this app has
 * actually observed (confirmed live against Studio Next, not guessed)
 * into messages a non-developer can act on -- a page meant to be checked
 * by another wallet or agent runtime, or by a human glancing at a Rein
 * that doesn't exist, should never show "Version: viem@2.56.5" text.
 */
export function describeReadError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(message)) {
    return "No Rein exists at this address on Studio Next -- check the address and try again.";
  }
  if (/incorrect address format/i.test(message)) {
    return "That isn't a valid address.";
  }
  if (/timed out/i.test(message)) {
    return "Studio Next didn't respond in time. It has known intermittent read failures -- try again in a moment.";
  }
  return "Couldn't read this Rein from Studio Next. Try again in a moment.";
}

export function useGenLayerClient(): {
  client: GenLayerClient<GenLayerChain> | null;
  address: `0x${string}` | undefined;
} {
  const { address, isConnected, connector } = useAccount();
  const [client, setClient] = useState<GenLayerClient<GenLayerChain> | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!isConnected || !address || !connector) {
      setClient(null);
      return;
    }
    connector
      .getProvider()
      .then((provider) => {
        if (cancelled) return;
        setClient(
          createClient({
            chain: studioNext,
            account: address,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            provider: provider as any,
          })
        );
      })
      .catch(() => {
        if (!cancelled) setClient(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isConnected, address, connector]);

  return { client, address };
}

// ---------------------------------------------------------------------
// Consensus polling -- drives the visible SIGN -> PENDING -> ACCEPTED ->
// FINALIZED transaction lifecycle directly off real chain state.
// ---------------------------------------------------------------------

const TERMINAL_STATUSES = new Set<TransactionStatus>([
  TransactionStatus.ACCEPTED,
  TransactionStatus.FINALIZED,
  TransactionStatus.UNDETERMINED,
  TransactionStatus.CANCELED,
  TransactionStatus.VALIDATORS_TIMEOUT,
  TransactionStatus.LEADER_TIMEOUT,
]);

const FINALIZED_REQUIRED_STATUSES = new Set<TransactionStatus>([
  TransactionStatus.FINALIZED,
  TransactionStatus.UNDETERMINED,
  TransactionStatus.CANCELED,
  TransactionStatus.VALIDATORS_TIMEOUT,
  TransactionStatus.LEADER_TIMEOUT,
]);

export interface ConsensusTick {
  status: TransactionStatus;
  transaction: GenLayerTransaction;
}

const MAX_CONSECUTIVE_RPC_FAILURES = 4;

export class PollCancelledError extends Error {
  constructor() {
    super("Polling was cancelled");
    this.name = "PollCancelledError";
  }
}

/**
 * Polls the real transaction status until a terminal state is reached,
 * invoking onTick on every observed status change. adjudicate() should
 * pass requireFinalized: true, since its output changes what the world
 * (other wallets/agents querying halt + remaining cap) should honor.
 */
export async function pollConsensusStatus(
  client: GenLayerClient<GenLayerChain>,
  hash: `0x${string}`,
  onTick: (tick: ConsensusTick) => void,
  {
    intervalMs,
    maxAttempts,
    isCancelled = () => false,
    requireFinalized = false,
  }: {
    intervalMs?: number;
    maxAttempts?: number;
    isCancelled?: () => boolean;
    requireFinalized?: boolean;
  } = {}
): Promise<GenLayerTransaction> {
  const terminalStatuses = requireFinalized ? FINALIZED_REQUIRED_STATUSES : TERMINAL_STATUSES;
  const effectiveIntervalMs = intervalMs ?? (requireFinalized ? 5000 : 1500);
  const effectiveMaxAttempts = maxAttempts ?? (requireFinalized ? 100 : 120);
  let lastStatus: TransactionStatus | null = null;
  let consecutiveFailures = 0;

  for (let attempt = 0; attempt < effectiveMaxAttempts; attempt++) {
    if (isCancelled()) throw new PollCancelledError();

    let transaction: GenLayerTransaction;
    try {
      transaction = await client.getTransaction({ hash: hash as TransactionHash });
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      if (consecutiveFailures > MAX_CONSECUTIVE_RPC_FAILURES) throw err;
      await new Promise((resolve) => setTimeout(resolve, effectiveIntervalMs));
      continue;
    }

    const status = transaction.statusName ?? TransactionStatus.PENDING;

    if (status !== lastStatus) {
      onTick({ status, transaction });
      lastStatus = status;
    }

    if (terminalStatuses.has(status)) {
      return transaction;
    }

    if (isCancelled()) throw new PollCancelledError();
    await new Promise((resolve) => setTimeout(resolve, effectiveIntervalMs));
  }

  throw new Error(
    requireFinalized
      ? "Timed out waiting for the transaction to finalize."
      : "Timed out waiting for transaction to reach a terminal status"
  );
}

// ---------------------------------------------------------------------
// Strict success/failure determination -- a terminal consensus status
// (ACCEPTED/FINALIZED) means the network agreed on an outcome, not that
// the outcome was a successful execution. A gl.vm.UserError revert still
// reaches ACCEPTED with txExecutionResultName: FINISHED_WITH_ERROR.
// ---------------------------------------------------------------------

const SUCCESS_STATUSES = new Set<TransactionStatus>([TransactionStatus.ACCEPTED, TransactionStatus.FINALIZED]);

export interface TransactionOutcome {
  succeeded: boolean;
  reason: string | null;
}

export function describeTransactionOutcome(transaction: GenLayerTransaction): TransactionOutcome {
  const status = transaction.statusName;
  const result = transaction.txExecutionResultName;

  if (!status || !SUCCESS_STATUSES.has(status)) {
    return { succeeded: false, reason: `Transaction did not reach consensus (status: ${status ?? "unknown"}).` };
  }

  if (result === ExecutionResult.FINISHED_WITH_RETURN) {
    return { succeeded: true, reason: null };
  }

  if (result === ExecutionResult.FINISHED_WITH_ERROR) {
    return {
      succeeded: false,
      reason: "The transaction reached consensus but reverted on-chain -- nothing was changed. Check the contract's error message and try again.",
    };
  }

  return {
    succeeded: false,
    reason: `Transaction reached consensus but its execution result is unconfirmed (${result ?? "missing"}). Not treating this as a success.`,
  };
}
