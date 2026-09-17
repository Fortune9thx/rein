/**
 * Deploys ReinFactory.py (with Rein.py's source embedded as its constructor
 * argument, matching the verified genlayerlabs "Registry" factory pattern)
 * to GenLayer Studio Next, and writes the resulting address into
 * frontend/.env.local as NEXT_PUBLIC_REIN_FACTORY_ADDRESS, plus this repo's
 * own .env as REIN_FACTORY_ADDRESS.
 *
 * Usage (raw private key):
 *   PRIVATE_KEY=0x... node deploy/deploy.mjs
 *
 * Usage (a genlayer CLI keystore, decrypted in-process, never written to
 * disk or printed):
 *   KEYSTORE_PATH=/path/to/keystore.json KEYSTORE_PASSWORD=... node deploy/deploy.mjs
 *
 * This script is never run automatically by any other part of this repo --
 * a human runs it deliberately, with a deliberately-funded deployer key.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet as studioNext } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { Wallet } from "ethers";

// Studio Next is genlayer-js's `studioDevnet` export (id 61997, RPC
// https://studio-dev.genlayer.com/api), only available from the
// 2.0.0-rc.1 release candidate -- genlayer-js@1.1.8's own `studionet`
// export is a DIFFERENT, older network (id 61999). This is the real thing,
// with real deployed Consensus contract addresses, required for
// deployContract to route correctly. See frontend/lib/chains.ts for the
// full citation.

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REIN_PATH = join(ROOT, "contracts", "Rein.py");
const FACTORY_PATH = join(ROOT, "contracts", "ReinFactory.py");
const ROOT_ENV_PATH = join(ROOT, ".env");
const FRONTEND_ENV_LOCAL_PATH = join(ROOT, "frontend", ".env.local");

// Deliberately excludes ACCEPTED -- ACCEPTED can still be appealed and
// reversed before FINALIZED, and this script writes the resulting address
// straight into the frontend's env, which the frontend then treats as the
// live contract. There is no latency budget to protect here.
const TERMINAL_STATUSES = new Set([
  TransactionStatus.FINALIZED,
  TransactionStatus.UNDETERMINED,
  TransactionStatus.CANCELED,
  TransactionStatus.LEADER_TIMEOUT,
  TransactionStatus.VALIDATORS_TIMEOUT,
]);

async function resolvePrivateKey() {
  if (process.env.PRIVATE_KEY) return process.env.PRIVATE_KEY;

  const keystorePath = process.env.KEYSTORE_PATH;
  const keystorePassword = process.env.KEYSTORE_PASSWORD;
  if (keystorePath && keystorePassword) {
    const keystoreJson = readFileSync(keystorePath, "utf-8");
    const wallet = await Wallet.fromEncryptedJson(keystoreJson, keystorePassword);
    return wallet.privateKey;
  }

  throw new Error(
    "Set PRIVATE_KEY, or both KEYSTORE_PATH and KEYSTORE_PASSWORD, in the environment before deploying."
  );
}

async function pollUntilTerminal(client, hash, { intervalMs = 3000, maxAttempts = 100 } = {}) {
  let lastStatus = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const transaction = await client.getTransaction({ hash });
    const status = transaction.statusName ?? TransactionStatus.PENDING;
    if (status !== lastStatus) {
      console.log(`  status: ${status}`);
      lastStatus = status;
    }
    if (TERMINAL_STATUSES.has(status)) return transaction;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for deployment to reach a terminal status");
}

function upsertEnvVar(path, key, value) {
  let contents = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(contents)) {
    contents = contents.replace(pattern, line);
  } else {
    contents += (contents.endsWith("\n") || contents === "" ? "" : "\n") + line + "\n";
  }
  writeFileSync(path, contents);
}

async function main() {
  const privateKey = await resolvePrivateKey();
  const account = createAccount(privateKey);
  const client = createClient({ chain: studioNext, account });

  const reinSource = readFileSync(REIN_PATH, "utf-8");
  const factorySource = readFileSync(FACTORY_PATH, "utf-8");

  console.log(`Deploying ReinFactory to ${studioNext.name} as ${account.address}...`);

  // This network rejects any deploy/write whose fee distribution is the
  // client's all-zero default (FeeValueMustBeNonZero) -- a raw feeValue
  // alone doesn't populate the on-chain feesDistribution struct the
  // Consensus contract actually checks. client.estimateTransactionFees()
  // is genlayer-js's own recommended-preset builder for Studio networks
  // (confirmed live against Studio Devnet) and returns both a real
  // distribution and its matching feeValue together.
  const estimatedFees = await client.estimateTransactionFees();
  console.log(`Estimated fee value: ${estimatedFees.feeValue}`);

  const hash = await client.deployContract({
    code: factorySource,
    args: [reinSource],
    fees: { distribution: estimatedFees.distribution, feeValue: estimatedFees.feeValue },
  });
  console.log(`Deploy tx: ${hash}`);

  const transaction = await pollUntilTerminal(client, hash);

  if (transaction.statusName !== TransactionStatus.FINALIZED) {
    throw new Error(`Deployment did not finalize (status: ${transaction.statusName}).`);
  }
  // FINALIZED means the network reached CONSENSUS on an outcome -- it does
  // NOT mean execution succeeded. A confirmed real failure mode on this
  // network: a deploy reaches FINALIZED with txExecutionResultName
  // FINISHED_WITH_ERROR (e.g. a stale/unsupported runner hash), and every
  // address-extraction fallback below still resolves to a real-looking
  // address for a contract that was never actually created. Always check
  // execution result, never statusName alone.
  if (transaction.txExecutionResultName !== "FINISHED_WITH_RETURN") {
    throw new Error(
      `Deployment reached consensus but execution failed (txExecutionResultName: ${transaction.txExecutionResultName}). ` +
        `Check consensus_data.validators[].result on this tx hash for the decoded error.`
    );
  }

  const deployedAddress =
    transaction.txDataDecoded?.contractAddress ??
    transaction.contractAddress ??
    transaction.to_address;
  if (!deployedAddress) {
    throw new Error(`Deployment succeeded but no contract address was found in the receipt: ${JSON.stringify(transaction)}`);
  }

  upsertEnvVar(ROOT_ENV_PATH, "REIN_FACTORY_ADDRESS", deployedAddress);
  upsertEnvVar(FRONTEND_ENV_LOCAL_PATH, "NEXT_PUBLIC_REIN_FACTORY_ADDRESS", deployedAddress);

  console.log(`\nDeployed ReinFactory at ${deployedAddress}`);
  console.log(`Deploy tx hash: ${hash}`);
  console.log(`Written to .env and frontend/.env.local`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
