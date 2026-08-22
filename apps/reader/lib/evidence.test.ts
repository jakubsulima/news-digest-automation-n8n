import { describe, expect, it } from "vitest";

import { evidenceDetailsFromPayload, evidenceDetailsFromSignals } from "./evidence";

describe("evidence details", () => {
  it("prioritizes readable full text", () => {
    expect(evidenceDetailsFromSignals({ contentModes: ["readable"], hasReadableVariant: true, sourceCount: 1 })).toMatchObject({
      fullTextSourceCount: 1,
      status: "full_text",
    });
  });

  it("marks multiple summaries as corroborated", () => {
    expect(evidenceDetailsFromSignals({ sourceCount: 2 })).toMatchObject({
      independentSourceCount: 2,
      status: "corroborated_summary",
    });
  });

  it("keeps a single incomplete source limited", () => {
    expect(evidenceDetailsFromPayload({}, 1)).toMatchObject({ status: "limited" });
  });

  it("honors an explicitly stored status", () => {
    expect(evidenceDetailsFromPayload({ evidence: { status: "limited" } }, 3)).toMatchObject({ status: "limited" });
  });
});
