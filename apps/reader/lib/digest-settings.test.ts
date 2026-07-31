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

  it("parses per-category final feed limits, including exclusions", () => {
    const formData = new FormData();
    formData.set("feedTargetGeopolitics", "3");
    formData.set("feedTargetBusiness", "0");
    formData.set("feedTargetAi", "12");
    formData.set("feedTargetSoftware", "51");
    formData.set("feedTargetSecurity", "-1");

    const settings = digestSettingsFromFormData(formData);

    expect(settings.feedTargets).toEqual({
      geopolitics: 3,
      business: 0,
      ai: 12,
      software: 50,
      security: 0,
    });
  });
});
