import { describe, expect, it } from "vitest";
import {
  isDrpcRpcHost,
  maybeRewriteAztecRpcForHost,
  rewriteAztecRpcMethodsForDrpc,
} from "./drpc-rpc.ts";

describe("dRPC JSON-RPC prefix rewrite", () => {
  it("detects public and keyed dRPC hosts", () => {
    expect(isDrpcRpcHost("https://aztec-mainnet.drpc.org")).toBe(true);
    expect(isDrpcRpcHost("https://lb.drpc.live/aztec-mainnet/key")).toBe(true);
    expect(isDrpcRpcHost("aztec-mainnet.drpc.org")).toBe(true);
  });

  it("leaves official and local nodes unchanged", () => {
    expect(isDrpcRpcHost("https://v5.testnet.rpc.aztec-labs.com")).toBe(false);
    expect(isDrpcRpcHost("https://v5.mainnet.rpc.aztec-labs.com")).toBe(false);
    expect(isDrpcRpcHost("http://localhost:8080")).toBe(false);
  });

  it("rewrites aztec_ methods on a single call and a batch", () => {
    expect(
      rewriteAztecRpcMethodsForDrpc({
        jsonrpc: "2.0",
        id: 1,
        method: "aztec_getL1ToL2MessageCheckpoint",
        params: ["0xabc"],
      }),
    ).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "node_getL1ToL2MessageCheckpoint",
      params: ["0xabc"],
    });

    expect(
      rewriteAztecRpcMethodsForDrpc([
        { method: "aztec_getBlockNumber", id: 1 },
        { method: "node_getNodeInfo", id: 2 },
      ]),
    ).toEqual([
      { method: "node_getBlockNumber", id: 1 },
      { method: "node_getNodeInfo", id: 2 },
    ]);
  });

  it("only rewrites when the host is dRPC", () => {
    const body = { method: "aztec_getL1ToL2MessageCheckpoint" };
    expect(maybeRewriteAztecRpcForHost("https://aztec-mainnet.drpc.org", body)).toEqual({
      method: "node_getL1ToL2MessageCheckpoint",
    });
    expect(maybeRewriteAztecRpcForHost("http://localhost:8080", body)).toBe(body);
  });
});
