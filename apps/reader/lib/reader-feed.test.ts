import { describe, expect, it } from "vitest";

import { decodeFeedCursor, encodeFeedCursor } from "./reader-feed";

describe("reader feed cursor", () => {
  it("round-trips stable item ids and rejects empty cursors", () => {
    const cursor = encodeFeedCursor("f8b4a080-0e28-4a7c-b447-ecf174065c5a");
    expect(decodeFeedCursor(cursor)).toBe("f8b4a080-0e28-4a7c-b447-ecf174065c5a");
    expect(decodeFeedCursor("!!!")).toBeNull();
  });
});
