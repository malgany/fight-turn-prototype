import { describe, expect, it } from "vitest";
import { calculateLocalTurnDeadlineMs, canForwardOnlineAction, hasAuthoritativeBattleStarted, isRetryableOnlineActionError } from "./app";
import { createInitialBattleState } from "./domain/battle";

describe("calculateLocalTurnDeadlineMs", () => {
  it("caps a buffered server deadline to the normal choice duration", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const deadline = new Date(now + 30_000).toISOString();

    expect(calculateLocalTurnDeadlineMs(deadline, createInitialBattleState(), 0, false, now)).toBe(now + 5_000);
  });

  it("does not reopen an expired authoritative turn after visuals finish", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const deadline = new Date(now - 1_000).toISOString();

    expect(calculateLocalTurnDeadlineMs(deadline, createInitialBattleState(), 0, true, now)).toBe(now);
  });

  it("uses the shorter guaranteed-turn duration when restarting", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const state = createInitialBattleState();
    state.activeGuaranteedTurn = { side: "p1", allowedActions: ["Special"], reason: "COMBO ACERTOU", durationMs: 3_000 };

    expect(calculateLocalTurnDeadlineMs(new Date(now + 10_000).toISOString(), state, 0, true, now)).toBe(now + 3_000);
  });

  it("caps a visual restart to the remaining authoritative time", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const deadline = new Date(now + 1_250).toISOString();

    expect(calculateLocalTurnDeadlineMs(deadline, createInitialBattleState(), 0, true, now)).toBe(now + 1_250);
  });
});

describe("hasAuthoritativeBattleStarted", () => {
  it("keeps the battle locked before the shared server start", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    expect(hasAuthoritativeBattleStarted({ battleStartAt: new Date(now + 5_000).toISOString() }, 0, now)).toBe(false);
  });

  it("unlocks at the shared start while accounting for server clock offset", () => {
    const localNow = Date.parse("2026-07-10T12:00:02.000Z");
    const serverNow = Date.parse("2026-07-10T12:00:00.000Z");
    expect(hasAuthoritativeBattleStarted({ battleStartAt: new Date(serverNow).toISOString() }, localNow - serverNow, localNow)).toBe(true);
  });

  it("preserves compatibility for matches without a synchronized start", () => {
    expect(hasAuthoritativeBattleStarted({ battleStartAt: null })).toBe(true);
  });
});

describe("canForwardOnlineAction", () => {
  it("forwards active-match clicks and leaves start-time authority to the server", () => {
    expect(canForwardOnlineAction({ status: "active" })).toBe(true);
  });

  it("does not forward clicks outside the active battle", () => {
    expect(canForwardOnlineAction({ status: "loading" })).toBe(false);
    expect(canForwardOnlineAction({ status: "finished" })).toBe(false);
    expect(canForwardOnlineAction(null)).toBe(false);
  });
});

describe("isRetryableOnlineActionError", () => {
  it("retries transient browser and edge-function failures", () => {
    expect(isRetryableOnlineActionError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableOnlineActionError(new Error("Network connection lost"))).toBe(true);
    expect(isRetryableOnlineActionError(new Error("Falha em submit-action."))).toBe(true);
  });

  it("does not retry permanent gameplay rejections", () => {
    expect(isRetryableOnlineActionError(new Error("Acao nao permitida neste turno."))).toBe(false);
    expect(isRetryableOnlineActionError(new Error("Sessao ausente."))).toBe(false);
  });
});
