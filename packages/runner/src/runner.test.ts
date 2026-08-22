import { describe, expect, it } from "vitest";
import { sanitizeText } from "./runner";

describe("runner recording redaction", () => {
  it("removes credential-like headers and query values before event persistence", () => {
    const value = sanitizeText("Authorization: Bearer secret-value cookie=session-value https://example.test/?token=abc123");
    expect(value).not.toContain("secret-value");
    expect(value).not.toContain("session-value");
    expect(value).not.toContain("abc123");
    expect(value).toContain("[REDACTED]");
  });
});
