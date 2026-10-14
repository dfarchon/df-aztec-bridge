import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppErrorToastList } from "./AppErrorToaster.tsx";

describe("AppErrorToastList", () => {
  it("renders the error title", () => {
    const html = renderToStaticMarkup(
      <AppErrorToastList
        entries={[
          {
            id: "1",
            at: 0,
            title: "DF Punk account secret missing.",
          },
        ]}
        onDismiss={() => {}}
      />,
    );
    expect(html).toContain("DF Punk account secret missing.");
    expect(html).toContain("app-error-toaster");
  });
});
