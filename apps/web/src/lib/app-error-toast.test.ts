import { describe, expect, it } from "vitest";
import { pushAppError, subscribeAppError, type AppErrorToastInput } from "./app-error-toast.ts";

describe("pushAppError", () => {
  it("delivers a pending error to a late subscriber", () => {
    const seen: AppErrorToastInput[] = [];
    pushAppError({ title: "DF Punk account secret missing." });
    const unsub = subscribeAppError((entry) => seen.push(entry));
    unsub();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.title).toBe("DF Punk account secret missing.");
  });
});
