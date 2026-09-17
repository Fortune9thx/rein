import { studioDevnet } from "genlayer-js/chains";

/**
 * GenLayer Studio Next -- genlayer-js@1.1.8 (the latest npm-tagged release)
 * has no chain export for it at all, and its own `studionet` export is a
 * DIFFERENT, older network (id 61999, https://studio.genlayer.com/api).
 * The real thing is `studioDevnet` in the 2.0.0-rc.1 release candidate:
 * id 61997, RPC https://studio-dev.genlayer.com/api, with real deployed
 * Consensus contract addresses (confirmed by reading the published
 * package's own source: node_modules/genlayer-js/dist/chunk-DQFRJO5T.js) --
 * required for gl.deploy_contract to work at all, since genlayer-js routes
 * every deploy through the chain's configured consensusMainContract.
 * Re-exported under the REIN-facing name `studioNext` so the rest of this
 * app never has to know genlayer-js's internal "devnet" naming.
 */
export const studioNext = studioDevnet;
