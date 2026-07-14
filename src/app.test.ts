import { describe, expect, it } from "vitest";
import { calculateLocalTurnDeadlineMs, canForwardOnlineAction, hasAuthoritativeBattleStarted, isMatchRefreshStillRelevant, isReplayScrollNearLatest, isRetryableOnlineActionError, MATCH_FOUND_REVEAL_DELAY_MS, normalizeReplayResolutionText, normalizedAudioVolume, rankAfterFinishedMatch, rankHudVisual, rankProgressPresentation, shouldPreserveMatchFoundRevealDom, shouldShowMatchFoundReveal, validateProfileDisplayName } from "./app";
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

describe("normalizedAudioVolume", () => {
  it("keeps an absent preference muted so online matches the local options screen", () => {
    expect(normalizedAudioVolume(null)).toBe(0);
  });

  it("clamps stored percentage values to the valid audio range", () => {
    expect(normalizedAudioVolume("0")).toBe(0);
    expect(normalizedAudioVolume("50")).toBe(0.5);
    expect(normalizedAudioVolume("500")).toBe(1);
    expect(normalizedAudioVolume("invalid")).toBe(0);
  });
});

describe("normalizeReplayResolutionText", () => {
  it("corrects legacy replay accents and uses agarrão as the noun", () => {
    expect(normalizeReplayResolutionText("P1 SEM ACAO")).toBe("P1 SEM AÇÃO");
    expect(normalizeReplayResolutionText("P2 escapou do agarro")).toBe("P2 escapou do agarrão");
    expect(normalizeReplayResolutionText("AGARRAO QUEBRADO")).toBe("AGARRÃO QUEBRADO");
    expect(normalizeReplayResolutionText("Combo nao conectou")).toBe("Combo não conectou");
    expect(normalizeReplayResolutionText("Ninguem escolheu ataque")).toBe("Ninguém escolheu ataque");
  });
});

describe("isReplayScrollNearLatest", () => {
  it("keeps automatic following near the end of the replay list", () => {
    expect(isReplayScrollNearLatest(440, 1000, 500)).toBe(true);
    expect(isReplayScrollNearLatest(200, 1000, 500)).toBe(false);
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

describe("validateProfileDisplayName", () => {
  it("accepts names with 4 to 15 letters and numbers", () => {
    expect(validateProfileDisplayName("Tony2026")).toBeNull();
    expect(validateProfileDisplayName("Abc1")).toBeNull();
    expect(validateProfileDisplayName("ABCDEFGHIJKLMNO")).toBeNull();
  });

  it("rejects spaces, symbols and lengths outside the allowed range", () => {
    expect(validateProfileDisplayName("Tony Barbosa")).not.toBeNull();
    expect(validateProfileDisplayName("Tony_Barbosa")).not.toBeNull();
    expect(validateProfileDisplayName("Ab1")).not.toBeNull();
    expect(validateProfileDisplayName("ABCDEFGHIJKLMNOP")).not.toBeNull();
  });
});

describe("rankHudVisual", () => {
  it("maps numbered divisions to their color family and badge numeral", () => {
    expect(rankHudVisual("Autoprimata II")).toEqual({ className: "rank-hud-autoprimata", badge: "II" });
    expect(rankHudVisual("Bronze III")).toEqual({ className: "rank-hud-bronze", badge: "III" });
    expect(rankHudVisual("Prata I")).toEqual({ className: "rank-hud-prata", badge: "I" });
    expect(rankHudVisual("Ouro II")).toEqual({ className: "rank-hud-ouro", badge: "II" });
  });

  it("uses distinct emblems for the transcendent divisions", () => {
    expect(rankHudVisual("Desperto")).toEqual({ className: "rank-hud-desperto", badge: "D" });
    expect(rankHudVisual("Arcanjo")).toEqual({ className: "rank-hud-arcanjo", badge: "A" });
    expect(rankHudVisual("Primordial")).toEqual({ className: "rank-hud-primordial", badge: "P" });
  });
});

describe("rankProgressPresentation", () => {
  it("calculates progress inside the current division", () => {
    expect(rankProgressPresentation(130)).toEqual({
      division: "Autoprimata II",
      nextDivision: "Autoprimata I",
      progress: 30,
      pointsRemaining: 70,
    });
  });

  it("switches presentation exactly at a promotion boundary", () => {
    expect(rankProgressPresentation(200)).toEqual({
      division: "Autoprimata I",
      nextDivision: "Bronze III",
      progress: 0,
      pointsRemaining: 100,
    });
  });

  it("clamps negative points to the bottom of the ladder", () => {
    expect(rankProgressPresentation(-10)).toEqual({
      division: "Autoprimata III",
      nextDivision: "Autoprimata II",
      progress: 0,
      pointsRemaining: 100,
    });
  });
});

describe("rankAfterFinishedMatch", () => {
  const rank = {
    userId: "player-1",
    rankPoints: 90,
    division: "Autoprimata III" as const,
    wins: 4,
    losses: 2,
    streak: 2,
    bestStreak: 3,
  };

  it("shows the updated points, division, wins and streak after a ranked victory", () => {
    expect(rankAfterFinishedMatch(rank, { matchType: "ranked", winnerId: "player-1", rankDelta: 40 }, "player-1")).toEqual({
      ...rank,
      rankPoints: 130,
      division: "Autoprimata II",
      wins: 5,
      streak: 3,
    });
  });

  it("shows the updated loss and resets the streak after a ranked defeat", () => {
    expect(rankAfterFinishedMatch(rank, { matchType: "ranked", winnerId: "player-2", rankDelta: -10 }, "player-1")).toEqual({
      ...rank,
      rankPoints: 80,
      losses: 3,
      streak: 0,
    });
  });
});

describe("isMatchRefreshStillRelevant", () => {
  it("rejects a delayed refresh after the player has returned to the lobby", () => {
    expect(isMatchRefreshStillRelevant("match-1", null)).toBe(false);
  });

  it("rejects a delayed refresh from a previous match", () => {
    expect(isMatchRefreshStillRelevant("match-1", { id: "match-2" })).toBe(false);
  });

  it("accepts a refresh for the match that is still open", () => {
    expect(isMatchRefreshStillRelevant("match-1", { id: "match-1" })).toBe(true);
  });
});

describe("shouldShowMatchFoundReveal", () => {
  const rankedMatch = { id: "match-1", matchType: "ranked" as const };

  it("shows the opponent reveal when ranked matchmaking finds a new match", () => {
    expect(shouldShowMatchFoundReveal("ranked-queue", null, rankedMatch)).toBe(true);
    expect(shouldShowMatchFoundReveal("online", null, rankedMatch)).toBe(true);
    expect(MATCH_FOUND_REVEAL_DELAY_MS).toBe(10_000);
  });

  it("does not repeat the reveal for refreshes of the same match", () => {
    expect(shouldShowMatchFoundReveal("match-found", "match-1", rankedMatch)).toBe(false);
    expect(shouldShowMatchFoundReveal("match-character-select", "match-1", rankedMatch)).toBe(false);
  });

  it("keeps private-room matchmaking on its existing flow", () => {
    expect(shouldShowMatchFoundReveal("private-room", null, { id: "private-1", matchType: "private" })).toBe(false);
  });
});

describe("shouldPreserveMatchFoundRevealDom", () => {
  it("keeps the opponent card mounted during refreshes inside the reveal window", () => {
    expect(shouldPreserveMatchFoundRevealDom("match-found", "match-1", "match-1", true)).toBe(true);
  });

  it("allows rendering after the reveal ends or the match changes", () => {
    expect(shouldPreserveMatchFoundRevealDom("match-found", "match-1", "match-1", false)).toBe(false);
    expect(shouldPreserveMatchFoundRevealDom("match-found", "match-1", "match-2", true)).toBe(false);
    expect(shouldPreserveMatchFoundRevealDom("match-character-select", "match-1", "match-1", true)).toBe(false);
  });
});
