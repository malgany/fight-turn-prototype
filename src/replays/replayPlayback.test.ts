import { describe, expect, it } from "vitest";
import { createInitialBattleState, resolveBattleTurn } from "../domain/battle";
import type { LocalReplay, ReplayTurnRecord } from "../types";
import {
  REPLAY_STEP_DURATION_MS,
  ReplayPlaybackController,
  type ReplayPlaybackScheduler,
  type ReplayPlaybackState,
} from "./replayPlayback";

class FakeScheduler implements ReplayPlaybackScheduler {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delayMs, callback });
    return id;
  }

  clearTimeout(timer: unknown): void {
    this.timers.delete(timer as number);
  }

  advance(ms: number): void {
    const targetTime = this.time + ms;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= targetTime)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = targetTime;
  }

  get pendingTimerCount(): number {
    return this.timers.size;
  }
}

function makeTurn(turnNumber: number, beforeHealth: number, afterHealth: number): ReplayTurnRecord {
  const before = createInitialBattleState();
  before.turnNumber = turnNumber;
  before.p2.health = beforeHealth;
  const resolved = resolveBattleTurn(before, "Poke", "Block");
  return {
    turnNumber,
    result: {
      ...resolved,
      before: { ...resolved.before, p2: { ...resolved.before.p2, health: beforeHealth }, turnNumber },
      after: { ...resolved.after, p2: { ...resolved.after.p2, health: afterHealth }, turnNumber: turnNumber + 1 },
    },
  };
}

function replayWithTurns(turns: ReplayTurnRecord[]): Pick<LocalReplay, "turns"> {
  return { turns };
}

describe("ReplayPlaybackController", () => {
  it("starts paused, reveals actions immediately, then result and following turns", () => {
    const scheduler = new FakeScheduler();
    const states: ReplayPlaybackState[] = [];
    const controller = new ReplayPlaybackController(
      replayWithTurns([makeTurn(1, 100, 94), makeTurn(2, 94, 88)]),
      (state) => states.push(state),
      scheduler,
    );

    expect(controller.getState()).toMatchObject({
      phase: "idle",
      playing: false,
      currentTurnIndex: -1,
      visibleTurnCount: 0,
      resultVisible: false,
    });
    expect(controller.getState().battleState?.p2.health).toBe(100);

    controller.togglePlay();
    expect(controller.getState()).toMatchObject({
      phase: "actions",
      playing: true,
      currentTurnIndex: 0,
      visibleTurnCount: 1,
      resultVisible: false,
    });

    scheduler.advance(REPLAY_STEP_DURATION_MS - 1);
    expect(controller.getState().phase).toBe("actions");
    scheduler.advance(1);
    expect(controller.getState()).toMatchObject({ phase: "result", resultVisible: true });
    expect(controller.getState().battleState?.p2.health).toBe(94);

    scheduler.advance(REPLAY_STEP_DURATION_MS);
    expect(controller.getState()).toMatchObject({
      phase: "actions",
      currentTurnIndex: 1,
      visibleTurnCount: 2,
      resultVisible: false,
    });
    expect(controller.getState().battleState?.p2.health).toBe(94);

    scheduler.advance(REPLAY_STEP_DURATION_MS * 2);
    expect(controller.getState()).toMatchObject({
      phase: "complete",
      playing: false,
      currentTurnIndex: 1,
      visibleTurnCount: 2,
      resultVisible: true,
    });
    expect(controller.getState().battleState?.p2.health).toBe(88);
    expect(states.length).toBeGreaterThan(4);
  });

  it("preserves base time remaining while paused", () => {
    const scheduler = new FakeScheduler();
    const controller = new ReplayPlaybackController(replayWithTurns([makeTurn(1, 100, 94)]), undefined, scheduler);

    controller.play();
    scheduler.advance(600);
    controller.pause();
    scheduler.advance(5000);
    expect(controller.getState()).toMatchObject({ phase: "actions", playing: false });

    controller.play();
    scheduler.advance(1199);
    expect(controller.getState().phase).toBe("actions");
    scheduler.advance(1);
    expect(controller.getState().phase).toBe("result");
  });

  it("resynchronizes the active interval immediately when speed changes", () => {
    const scheduler = new FakeScheduler();
    const controller = new ReplayPlaybackController(
      replayWithTurns([makeTurn(1, 100, 94), makeTurn(2, 94, 88)]),
      undefined,
      scheduler,
    );

    controller.play();
    scheduler.advance(300);
    expect(controller.cycleSpeed()).toBe(2);
    scheduler.advance(749);
    expect(controller.getState().phase).toBe("actions");
    scheduler.advance(1);
    expect(controller.getState()).toMatchObject({ phase: "result", speed: 2 });

    expect(controller.cycleSpeed()).toBe(3);
    scheduler.advance(599);
    expect(controller.getState().phase).toBe("result");
    scheduler.advance(1);
    expect(controller.getState()).toMatchObject({ phase: "actions", currentTurnIndex: 1, speed: 3 });
    expect(controller.cycleSpeed()).toBe(1);
  });

  it("clears timers on dispose and cannot restart", () => {
    const scheduler = new FakeScheduler();
    const controller = new ReplayPlaybackController(replayWithTurns([makeTurn(1, 100, 94)]), undefined, scheduler);

    controller.play();
    expect(scheduler.pendingTimerCount).toBe(1);
    controller.dispose();
    expect(scheduler.pendingTimerCount).toBe(0);
    controller.play();
    scheduler.advance(REPLAY_STEP_DURATION_MS * 3);
    expect(controller.getState()).toMatchObject({ phase: "actions", playing: false, resultVisible: false });
  });
});
