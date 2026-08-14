import { describe, expect, it } from "vitest";

import { localeTag, localize, normalizeReaderLocale } from "./reader-locale";

describe("reader locale", () => {
  it("defaults unknown values to Polish", () => {
    expect(normalizeReaderLocale(undefined)).toBe("pl");
    expect(normalizeReaderLocale("de")).toBe("pl");
  });

  it("keeps a supported English preference", () => {
    expect(normalizeReaderLocale("en")).toBe("en");
    expect(localeTag("en")).toBe("en-GB");
    expect(localize("en", "Ustawienia", "Settings")).toBe("Settings");
  });
});

