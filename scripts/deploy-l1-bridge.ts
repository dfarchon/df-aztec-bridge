/**
 * Deploy GoBridge (CREATE2) on a named L1 chain.
 *
 *   DEPLOYER_KEY=0x… pnpm deploy-l1-bridge [sepolia|mainnet|anvil]
 */
import type { Hex } from "viem";
import { deployL1Bridge, type ChainName } from "../src/vendor/gobridge/deterministic.js";

const VALID: ChainName[] = ["sepolia", "mainnet", "anvil"];

async function main() {
  const chainName = (process.argv[2] ?? "sepolia").toLowerCase() as ChainName;
  if (!VALID.includes(chainName)) {
    console.error(`Unknown chain: ${chainName}. Valid: ${VALID.join(", ")}`);
    process.exit(1);
  }

  const deployerKey = process.env.DEPLOYER_KEY as Hex | undefined;
  const rpcUrl = process.env.RPC_URL;

  const address = await deployL1Bridge({ chainName, rpcUrl, deployerKey });
  console.error(`GoBridge on ${chainName}: ${address}`);
  console.log(address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
