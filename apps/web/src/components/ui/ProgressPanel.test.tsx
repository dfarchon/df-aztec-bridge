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
    const html = render(finishProgress(startProgress("claim", "pxe", Date.now()), "failed")!);
    expect(html).not.toContain("progress-notice");
    expect(html).not.toContain("progress-spinner");
    expect(html).toContain("progress-panel-failed");
    expect(html).toContain("progress-step-failed");
  });

  it("shows the raw flow detail under the steps", () => {
    const html = render(startProgress("bridge", "prepare", Date.now()), "Preparing L1 clients");
    expect(html).toContain("Preparing L1 clients");
    expect(html).toContain("Bridging Fee Juice to Aztec");
  });
});
