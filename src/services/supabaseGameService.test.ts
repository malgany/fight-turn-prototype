import { describe, expect, it } from "vitest";
import { isInvalidAuthSessionError } from "./supabaseGameService";

describe("isInvalidAuthSessionError", () => {
  it("recognizes technical invalid and expired JWT messages", () => {
    expect(isInvalidAuthSessionError(new Error("Invalid JWT"))).toBe(true);
    expect(isInvalidAuthSessionError(new Error("JWT expired"))).toBe(true);
    expect(isInvalidAuthSessionError(new Error("Access token is invalid"))).toBe(true);
  });

  it("does not hide unrelated connection or gameplay failures", () => {
    expect(isInvalidAuthSessionError(new Error("Failed to fetch"))).toBe(false);
    expect(isInvalidAuthSessionError(new Error("Falha em submit-action."))).toBe(false);
  });
});
