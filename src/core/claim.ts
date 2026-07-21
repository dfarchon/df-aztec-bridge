/**
 * L2 Fee Juice claim helpers.
 * Adapted from aztec-kit `apps/bridge/src/services/l2/claim.ts`.
 */
import type { Wallet } from "@aztec/aztec.js/wallet";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { FeeJuiceContract } from "@aztec/aztec.js/protocol";
import { FeeJuicePaymentMethodWithClaim } from "@aztec/aztec.js/fee";
import { BatchCall } from "@aztec/aztec.js/contracts";
import { Fr } from "@aztec/foundation/curves/bn254";

import type { ClaimCredentials } from "./types.js";

/** Claim bridged FJ using the bridge claim to pay for its own gas (account has no FJ yet). */
export async function claimWithBootstrap(
  wallet: Wallet,
  callerAddress: AztecAddress,
  bootstrapClaim: ClaimCredentials,
) {
  const fj = FeeJuiceContract.at(wallet);
  const target = AztecAddress.fromStringUnsafe(bootstrapClaim.recipient);

  const paymentMethod = new FeeJuicePaymentMethodWithClaim(callerAddress, {
    claimAmount: BigInt(bootstrapClaim.claimAmount),
    claimSecret: Fr.fromHexString(bootstrapClaim.claimSecret),
    messageLeafIndex: BigInt(bootstrapClaim.messageLeafIndex),
  });

  return fj.methods
    .claim(
      target,
      BigInt(bootstrapClaim.claimAmount),
      Fr.fromHexString(bootstrapClaim.claimSecret),
      BigInt(bootstrapClaim.messageLeafIndex),
    )
    .send({ from: callerAddress, fee: { paymentMethod } });
}

export async function claimBatch(
  wallet: Wallet,
  callerAddress: AztecAddress,
  claims: ClaimCredentials[],
) {
  const fj = FeeJuiceContract.at(wallet);

  const calls = claims.map((c) => {
    const target = AztecAddress.fromStringUnsafe(c.recipient);
    return fj.methods.claim(
      target,
      BigInt(c.claimAmount),
      Fr.fromHexString(c.claimSecret),
      BigInt(c.messageLeafIndex),
    );
  });

  if (calls.length === 1) {
    return calls[0].send({ from: callerAddress });
  }

  const batch = new BatchCall(wallet, calls);
  return batch.send({ from: callerAddress });
}
