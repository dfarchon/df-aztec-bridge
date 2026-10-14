import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgressPanel } from "./ProgressPanel.tsx";
import { advanceProgress, finishProgress, startProgress } from "../../lib/progress-track.ts";

function render(progress: Parameters<typeof ProgressPanel>[0]["progress"], detail?: string) {
  return renderToStaticMarkup(
    <ProgressPanel progress={progress} detail={detail ?? null} onDismiss={() => {}} />,
  );
}

describe("ProgressPanel", () => {
  it("names the current step and counts it against the track", () => {
    const html = render(
      advanceProgress(startProgress("claim", "status", Date.now()), {
        track: "claim",
        stepKey: "prove",
      }),
    );
    expect(html).toContain("Claiming Fee Juice on Aztec L2");
    expect(html).toContain("Step 5 of 7");
    expect(html).toContain("Generating the proof and submitting the claim");
    expect(html).toContain("progress-step-active");
  });

  it("warns against leaving while the proof is still local", () => {
    const html = render(startProgress("claim", "pxe", Date.now()));
    expect(html).toContain("Do not refresh or close this tab");
    expect(html).toContain("progress-notice-warn");
    expect(html).toContain("progress-spinner");
  });

  it("switches to a safe-to-leave notice once the claim tx is submitted", () => {
    const html = render(
      advanceProgress(startProgress("claim", "status", Date.now()), {
        track: "claim",
        stepKey: "confirm",
        txSubmitted: true,
      }),
    );
    expect(html).toContain("Safe to leave now");
    expect(html).not.toContain("Do not refresh or close this tab");
  });

  it("drops the warning and the spinner once the flow ends", () => {
    const html = renderToStaticMarkup(
      <ProgressPanel
        progress={finishProgress(startProgress("claim", "pxe", Date.now()), "failed")!}
        detail="PXE failed to start"
        onDismiss={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(html).not.toContain("progress-notice");
    expect(html).not.toContain("progress-spinner");
    expect(html).toContain("progress-panel-failed");
    expect(html).toContain("progress-step-failed");
    expect(html).toContain("PXE failed to start");
    expect(html).toContain("Close");
    expect(html).toContain("Try again");
  });

  it("shows the raw flow detail under the steps", () => {
    const html = render(startProgress("bridge", "prepare", Date.now()), "Preparing L1 clients");
    expect(html).toContain("Preparing L1 clients");
    expect(html).toContain("Bridging Fee Juice to Aztec");
  });

  it("strips dashes from the detail under the steps", () => {
    const html = render(
      startProgress("bridge", "saved", Date.now()),
      "L1 bridge complete — credentials saved",
    );
    expect(html).toContain("L1 bridge complete. Credentials saved");
    expect(html).not.toContain("—");
  });

  it("places the Aztec tip block after the step list", () => {
    const html = renderToStaticMarkup(
      <ProgressPanel
        progress={startProgress("claim", "status", Date.now())}
        detail="Checking claim message status"
        aztecNodeUrl="https://example.invalid"
        onDismiss={() => {}}
      />,
    );
    expect(html.indexOf("aztec-block-estimate")).toBeGreaterThan(html.indexOf("progress-steps"));
  });

  it("offers Claim on L2 after a finished bridge", () => {
    const html = renderToStaticMarkup(
      <ProgressPanel
        progress={finishProgress(startProgress("bridge", "saved", Date.now()), "succeeded")!}
        detail="L1 bridge complete. Credentials saved locally and downloaded."
        onDismiss={() => {}}
        onClaimL2={() => {}}
      />,
    );
    expect(html).toContain("Claim on L2");
  });

  it("hides Claim on L2 while the claim track is running", () => {
    const html = renderToStaticMarkup(
      <ProgressPanel
        progress={startProgress("claim", "status", Date.now())}
        detail="Checking claim message status"
        onDismiss={() => {}}
        onClaimL2={() => {}}
      />,
    );
    expect(html).not.toContain("Claim on L2");
  });

  it("shows Transaction rejected with Close and Try again after a wallet cancel", () => {
    const html = renderToStaticMarkup(
      <ProgressPanel
        progress={finishProgress(startProgress("bridge", "approve", Date.now()), "rejected")!}
        detail="You cancelled the request in your wallet. Nothing was sent."
        onDismiss={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(html).toContain("Transaction rejected");
    expect(html).toContain("You cancelled the request in your wallet. Nothing was sent.");
    expect(html).toContain("Close");
    expect(html).toContain("Try again");
    expect(html).not.toContain("pick a wallet again");
    expect(html).toContain("progress-panel-rejected");
  });

  it("ends a successful claim with a clear reminder", () => {
    const html = renderToStaticMarkup(
      <ProgressPanel
        progress={finishProgress(startProgress("claim", "done", Date.now()), "succeeded")!}
        detail="L2 claim complete."
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain("Fee Juice is on this Aztec account.");
    expect(html).toContain("progress-success-line");
  });

  it("drops the overlay when embedded in Recover", () => {
    const html = renderToStaticMarkup(
      <ProgressPanel
        embedded
        progress={startProgress("claim", "status", Date.now())}
        detail={null}
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain("progress-panel-embedded");
    expect(html).not.toContain("progress-panel-backdrop");
  });
});
