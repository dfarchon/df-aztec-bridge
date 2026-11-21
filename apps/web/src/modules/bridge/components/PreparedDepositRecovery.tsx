import { useEffect, useState } from "react";
import { findPreparedDeposit, resumePendingBridge } from "@df-bridge/browser-sdk";
import type { Hex } from "viem";
import type { WebNetworkConfig } from "../../../config/networks.ts";
import { listPreparedDeposits, removePreparedDeposit, type PreparedDepositFile } from "../../../lib/prepared-deposit.ts";
import { currentVaultGuard, isVaultUnlocked } from "../../../lib/vault.ts";
import { upsertSession } from "../../../lib/bridge-session.ts";
import { shortHash } from "../../../lib/claim-recovery.ts";

function PreparedRow({ file, network, onRecovered }: {
  file: PreparedDepositFile;
  network: WebNetworkConfig;
  onRecovered: () => Promise<unknown>;
}) {
  const [retry, setRetry] = useState(0);
  const [hash, setHash] = useState("");
  const [manualHash, setManualHash] = useState<Hex | null>(null);
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(true);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (finished || !isVaultUnlocked()) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fromBlock = BigInt(file.deposit.fromBlock);
    const { signal } = controller;
    const guard = currentVaultGuard();
    async function check() {
      guard();
      const { deposit } = file;
      setChecking(true);
      setMessage("Checking Ethereum for the deposit…");
      if (deposit.portal.toLowerCase() !== network.l1Addresses.feeJuicePortal.toLowerCase() || deposit.chainId !== network.l1ChainId) {
        throw new Error("Select the original deposit network.");
      }
      let tx = manualHash;
      if (!tx) {
        const scan = await findPreparedDeposit({ ...deposit, fromBlock: fromBlock.toString() },
          network.l1ChainId, network.l1RpcUrl, signal);
        tx = scan.hash;
        // Re-read recent blocks in case the RPC head reorganizes.
        if (scan.throughBlock - 12n > fromBlock) fromBlock = scan.throughBlock - 12n;
      }
      signal.throwIfAborted();
      if (!tx) {
        setMessage("Waiting for a matching Ethereum deposit. Checking again in 15 seconds.");
        timer = setTimeout(run, 15_000);
        return;
      }
      const result = await resumePendingBridge({
        pending: { ...deposit, l1TxHash: tx }, chainId: network.l1ChainId, l1RpcUrl: network.l1RpcUrl,
      });
      signal.throwIfAborted();
      guard();
      await upsertSession(file.networkId, {
        l1TxHash: tx, phase: "ready-to-claim", credentials: result.credentials,
        claimAmount: deposit.claimAmount, recipient: deposit.recipient, preserveExisting: true,
      });
      guard();
      await removePreparedDeposit(deposit.claimSecretHash);
      if (!signal.aborted) setFinished(true);
      await onRecovered();
    }
    function run() {
      void check().catch(error => {
        if (!signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
      }).finally(() => { if (!signal.aborted) setChecking(false); });
    }
    run();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [file, network, onRecovered, manualHash, retry, finished]);
  if (finished) return null;
  return <div className="recovery-session-item">
    <strong>Prepared deposit to {shortHash(file.deposit.recipient)}</strong>
    <p className="hint" role="status">{message}</p>
    <button disabled={checking} onClick={() => { setManualHash(null); setRetry(i => i + 1); }}>Check Ethereum again</button>
    <details>
      <summary>Use a deposit transaction hash</summary>
      <input aria-label="Ethereum deposit transaction hash" value={hash} onChange={e => setHash(e.target.value.trim())} />
      <button disabled={!/^0x[0-9a-f]{64}$/i.test(hash)} onClick={() => {
        setManualHash(hash as Hex);
        setRetry(i => i + 1);
      }}>Verify receipt</button>
    </details>
    <button className="ghost" disabled={checking} onClick={async () => {
      if (!window.confirm("Delete the saved claim secret? If a deposit was submitted, you may permanently lose the ability to claim it.")) return;
      try {
        await removePreparedDeposit(file.deposit.claimSecretHash);
        setFinished(true);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }}>Discard preparation</button>
  </div>;
}

export function PreparedDepositRecovery({ network, onRecovered, importRequest }: {
  network: WebNetworkConfig;
  onRecovered: () => Promise<unknown>;
  importRequest: number;
}) {
  const [files, setFiles] = useState<PreparedDepositFile[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let ignore = false;
    listPreparedDeposits(network.id).then(rows => { if (!ignore) setFiles(rows); })
      .catch(cause => { if (!ignore) setError(String(cause)); });
    return () => { ignore = true; };
  }, [network.id, importRequest]);
  return <>{error && <p role="alert">{error}</p>}{files.map(file =>
    <PreparedRow key={file.deposit.claimSecretHash} file={file} network={network} onRecovered={onRecovered} />
  )}</>;
}
