import type { BattleState, LocalReplay, ReplayTurnRecord } from "../types";

export const REPLAY_STEP_DURATION_MS = 1800;

export type ReplayPlaybackSpeed = 1 | 2 | 3;
export type ReplayPlaybackPhase = "idle" | "actions" | "result" | "complete";

export interface ReplayPlaybackState {
  phase: ReplayPlaybackPhase;
  playing: boolean;
  speed: ReplayPlaybackSpeed;
  currentTurnIndex: number;
  visibleTurnCount: number;
  resultVisible: boolean;
  battleState: BattleState;
}

export interface ReplayPlaybackScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

export type ReplayPlaybackListener = (state: ReplayPlaybackState) => void;

const browserScheduler: ReplayPlaybackScheduler = {
  now: () => (typeof performance === "undefined" ? Date.now() : performance.now()),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as number),
};

function cloneBattleState(state: BattleState): BattleState {
  return {
    ...state,
    p1: { ...state.p1 },
    p2: { ...state.p2 },
    activeGuaranteedTurn: state.activeGuaranteedTurn
      ? { ...state.activeGuaranteedTurn, allowedActions: [...state.activeGuaranteedTurn.allowedActions] }
      : null,
    itzcoatlResurrectionUsed: { ...(state.itzcoatlResurrectionUsed || {}) },
    ultimateHealthThresholdsReached: {
      p1: [...(state.ultimateHealthThresholdsReached?.p1 || [])],
      p2: [...(state.ultimateHealthThresholdsReached?.p2 || [])],
    },
  };
}

function normalizedTurns(turns: readonly ReplayTurnRecord[]): ReplayTurnRecord[] {
  const byNumber = new Map<number, ReplayTurnRecord>();
  for (const turn of turns) byNumber.set(turn.turnNumber, turn);
  return [...byNumber.values()].sort((left, right) => left.turnNumber - right.turnNumber);
}

/**
 * Deterministic replay clock. It never resolves combat again: every HUD update is
 * copied directly from the stored TurnResolution.before/after snapshots.
 */
export class ReplayPlaybackController {
  private readonly turns: ReplayTurnRecord[];
  private readonly onChange: ReplayPlaybackListener;
  private readonly scheduler: ReplayPlaybackScheduler;
  private state: ReplayPlaybackState;
  private timer: unknown | null = null;
  private scheduledAt = 0;
  private scheduledSpeed: ReplayPlaybackSpeed = 1;
  private remainingBaseMs = REPLAY_STEP_DURATION_MS;
  private disposed = false;

  constructor(
    replay: Pick<LocalReplay, "turns">,
    onChange: ReplayPlaybackListener = () => undefined,
    scheduler: ReplayPlaybackScheduler = browserScheduler,
  ) {
    this.turns = normalizedTurns(replay.turns);
    this.onChange = onChange;
    this.scheduler = scheduler;

    if (this.turns.length === 0) {
      throw new Error("Não é possível reproduzir uma partida sem turnos.");
    }

    this.state = {
      phase: "idle",
      playing: false,
      speed: 1,
      currentTurnIndex: -1,
      visibleTurnCount: 0,
      resultVisible: false,
      battleState: cloneBattleState(this.turns[0].result.before),
    };
    this.notify();
  }

  getState(): ReplayPlaybackState {
    return {
      ...this.state,
      battleState: cloneBattleState(this.state.battleState),
    };
  }

  play(): void {
    if (this.disposed || this.state.playing || this.state.phase === "complete") return;

    this.state.playing = true;
    if (this.state.phase === "idle") {
      this.state.phase = "actions";
      this.state.currentTurnIndex = 0;
      this.state.visibleTurnCount = 1;
      this.state.resultVisible = false;
      this.state.battleState = cloneBattleState(this.turns[0].result.before);
      this.remainingBaseMs = REPLAY_STEP_DURATION_MS;
    }

    this.scheduleCurrentStep();
    this.notify();
  }

  pause(): void {
    if (this.disposed || !this.state.playing) return;
    this.consumeElapsedBaseTime();
    this.clearTimer();
    this.state.playing = false;
    this.notify();
  }

  togglePlay(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: ReplayPlaybackSpeed): void {
    if (this.disposed || this.state.speed === speed || ![1, 2, 3].includes(speed)) return;

    if (this.state.playing) {
      this.consumeElapsedBaseTime();
      this.clearTimer();
    }
    this.state.speed = speed;
    if (this.state.playing) this.scheduleCurrentStep();
    this.notify();
  }

  cycleSpeed(): ReplayPlaybackSpeed {
    const speed: ReplayPlaybackSpeed = this.state.speed === 1 ? 2 : this.state.speed === 2 ? 3 : 1;
    this.setSpeed(speed);
    return speed;
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.state.playing) this.consumeElapsedBaseTime();
    this.clearTimer();
    this.state.playing = false;
    this.disposed = true;
  }

  private consumeElapsedBaseTime(): void {
    if (this.timer === null) return;
    const elapsedWallMs = Math.max(0, this.scheduler.now() - this.scheduledAt);
    this.remainingBaseMs = Math.max(0, this.remainingBaseMs - elapsedWallMs * this.scheduledSpeed);
  }

  private scheduleCurrentStep(): void {
    if (this.disposed || !this.state.playing || this.state.phase === "complete") return;
    this.scheduledAt = this.scheduler.now();
    this.scheduledSpeed = this.state.speed;
    this.timer = this.scheduler.setTimeout(
      () => this.onStepTimer(),
      Math.max(0, this.remainingBaseMs / this.state.speed),
    );
  }

  private onStepTimer(): void {
    this.timer = null;
    this.remainingBaseMs = 0;
    if (this.disposed || !this.state.playing) return;

    if (this.state.phase === "actions") {
      const turn = this.turns[this.state.currentTurnIndex];
      this.state.phase = "result";
      this.state.resultVisible = true;
      this.state.battleState = cloneBattleState(turn.result.after);
      this.remainingBaseMs = REPLAY_STEP_DURATION_MS;
    } else if (this.state.phase === "result") {
      const nextTurnIndex = this.state.currentTurnIndex + 1;
      if (nextTurnIndex < this.turns.length) {
        const nextTurn = this.turns[nextTurnIndex];
        this.state.phase = "actions";
        this.state.currentTurnIndex = nextTurnIndex;
        this.state.visibleTurnCount = nextTurnIndex + 1;
        this.state.resultVisible = false;
        this.state.battleState = cloneBattleState(nextTurn.result.before);
        this.remainingBaseMs = REPLAY_STEP_DURATION_MS;
      } else {
        this.state.phase = "complete";
        this.state.playing = false;
        this.state.resultVisible = true;
      }
    }

    this.scheduleCurrentStep();
    this.notify();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  private notify(): void {
    this.onChange(this.getState());
  }
}
