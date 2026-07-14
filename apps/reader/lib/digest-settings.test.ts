import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { digestSettingsFromFormData } from "./digest-settings";

describe("digestSettingsFromFormData", () => {
  it("parses quality controls and clamps unsafe values", () => {
    const formData = new FormData();
    formData.set("freshnessWindowHours", "2");
    formData.set("minimumSourceCount", "4");
    formData.set("maxStoriesPerSource", "99");
    formData.set("preferredKeywords", " AI, Agents, ai ");
    formData.set("readableOnly", "on");
    formData.set("personalizationEnabled", "on");

    const settings = digestSettingsFromFormData(formData);

    expect(settings.freshnessWindowHours).toBe(6);
    expect(settings.minimumSourceCount).toBe(4);
    expect(settings.maxStoriesPerSource).toBe(20);
    expect(settings.preferredKeywords).toEqual(["ai", "agents"]);
    expect(settings.readableOnly).toBe(true);
    expect(settings.personalizationEnabled).toBe(true);
    expect(settings.implicitPersonalizationEnabled).toBe(false);
  });
});
