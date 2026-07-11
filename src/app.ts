import { characterById, characters } from "./data/characters";
import { selectableActions, turnDurationForState } from "./domain/battle";
import { RANK_RULES } from "./domain/ranking";
import { appRouteUrl } from "./lib/config";
import type { Action, AppSnapshot, BattleState, GameMatch, GuaranteedTurn, LeaderboardEntry, MatchHistoryEntry, PrivateRoom, RematchChoice, Side, TurnResolution } from "./types";
import type { GameService } from "./services/gameService";

const ACTION_SUBMIT_GRACE_MS = 1200;
const ACTION_SUBMIT_RETRY_DELAYS_MS = [0, 100] as const;
const POST_MATCH_REVEAL_DELAY_MS = 10_000;
const MATCH_START_REVEAL_DELAY_MS = 4_000;

type Screen =
  | "login"
  | "menu"
  | "profile"
  | "character-select"
  | "online"
  | "ranked-queue"
  | "private-room"
  | "match-character-select"
  | "battle"
  | "post-match"
  | "ranking"
  | "history";

interface AppState {
  screen: Screen;
  snapshot: AppSnapshot;
  loading: boolean;
  error: string | null;
  info: string | null;
  leaderboard: LeaderboardEntry[];
  history: MatchHistoryEntry[];
  characterUsage: Record<string, number>;
  room: PrivateRoom | null;
  match: GameMatch | null;
}

const emptySnapshot: AppSnapshot = {
  profile: null,
  rank: null,
  unlockedCharacterIds: [],
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function mostUsedCharacter(usage: Record<string, number>, fallbackId: string) {
  let characterId = fallbackId;
  let matches = 0;

  for (const [candidateId, candidateMatches] of Object.entries(usage)) {
    if (candidateMatches > matches) {
      characterId = candidateId;
      matches = candidateMatches;
    }
  }

  return { character: characterById(characterId), matches };
}

function countdown(deadline: string | null, serverClockOffsetMs = 0): string {
  if (!deadline) return "";
  const estimatedServerNow = Date.now() - serverClockOffsetMs;
  const remaining = Math.max(0, new Date(deadline).getTime() - estimatedServerNow);
  return String(Math.ceil(remaining / 1000));
}

export function calculateLocalTurnDeadlineMs(
  deadline: string,
  battleState: BattleState,
  serverClockOffsetMs = 0,
  restartFromNow = false,
  nowMs = Date.now(),
): number {
  const durationMs = turnDurationForState(battleState);
  const estimatedServerNow = nowMs - serverClockOffsetMs;
  const serverRemainingMs = new Date(deadline).getTime() - estimatedServerNow;
  // Visual transitions may restart the displayed clock, but they must never
  // reopen a turn whose authoritative server deadline has already elapsed.
  if (restartFromNow) return nowMs + Math.max(0, Math.min(durationMs, serverRemainingMs));
  return nowMs + Math.max(0, Math.min(durationMs, serverRemainingMs));
}

function oppositeSide(side: "p1" | "p2"): "p1" | "p2" {
  return side === "p1" ? "p2" : "p1";
}

function isLiveMatchStatus(status: GameMatch["status"]): boolean {
  return status === "selecting" || status === "loading" || status === "active" || status === "resolving";
}

export function hasAuthoritativeBattleStarted(match: Pick<GameMatch, "battleStartAt">, serverClockOffsetMs = 0, nowMs = Date.now()): boolean {
  if (!match.battleStartAt) return true;
  return nowMs - serverClockOffsetMs >= new Date(match.battleStartAt).getTime();
}

export function canForwardOnlineAction(match: Pick<GameMatch, "status"> | null): boolean {
  return match?.status === "active";
}

export function isRetryableOnlineActionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|load failed|network|connection|timeout|resposta vazia|falha em submit-action/i.test(message);
}

function legacyMainMenuUrl(): string {
  return appRouteUrl("prototype/mobile-layout/?skipIntro=1");
}

function usesMobileStage(screen: Screen): boolean {
  return [
    "login",
    "menu",
    "profile",
    "character-select",
    "online",
    "ranked-queue",
    "private-room",
    "match-character-select",
    "battle",
    "post-match",
    "ranking",
    "history",
  ].includes(screen);
}

function characterVisualClass(characterId: string): string {
  if (characterId === "itzcoatl") return "shaman";
  if (characterId === "aton") return "aton";
  if (characterId === "doll") return "doll";
  if (characterId === "coming-soon") return "coming-soon";
  return "ninja";
}

export class App {
  private state: AppState = {
    screen: "login",
    snapshot: emptySnapshot,
    loading: false,
    error: null,
    info: null,
    leaderboard: [],
    history: [],
    characterUsage: {},
    room: null,
    match: null,
  };

  private heartbeatId: number | null = null;
  private pollId: number | null = null;
  private timerId: number | null = null;
  private unsubscribeMatch: (() => void) | null = null;
  private unsubscribeRankedQueue: (() => void) | null = null;
  private unsubscribePrivateRoom: (() => void) | null = null;
  private serverClockOffsetMs = 0;
  private turnClockKey: string | null = null;
  private localTurnDeadlineMs: number | null = null;
  private initialBootstrapComplete = false;
  private resolvingExpiredTurn = false;
  private legacyBattleVisualBusyUntilMs = 0;
  private legacyBattleVisualBusyKey: string | null = null;
  private legacyBattleVisualReadyKey: string | null = null;
  private turnReadyRequestKey: string | null = null;
  private turnReadyConfirmedKey: string | null = null;
  private postMatchRevealTimerId: number | null = null;
  private postMatchRevealKey: string | null = null;
  private postMatchOverlayVisibleKey: string | null = null;
  private matchStartRevealTimerId: number | null = null;
  private matchStartRevealKey: string | null = null;
  private legacyBattleLoadedMatchId: string | null = null;
  private matchReadyRequestMatchId: string | null = null;
  private matchActionRequestKey: string | null = null;
  private rankingTab: "leaderboard" | "progression" = "leaderboard";

  constructor(
    private readonly root: HTMLElement,
    private readonly service: GameService,
  ) {}

  async start(): Promise<void> {
    this.bindEvents();
    await this.run("Carregando sessao...", async () => {
      this.state.snapshot = await this.service.getSnapshot();
      if (this.state.snapshot.profile?.accountType === "guest") {
        await this.service.signOut();
        this.state.snapshot = emptySnapshot;
      }
      this.state.screen = this.state.snapshot.profile ? "menu" : "login";
      await this.bootstrapIfAuthenticated();
    });
    this.initialBootstrapComplete = true;
    this.render();
  }

  private bindEvents(): void {
    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin) return;
      void this.handleLegacyBattleMessage(event.data);
    });

    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest<HTMLElement>("[data-action], [data-nav], [data-match-action]");
      if (!button) return;

      const action = button.dataset.action;
      const nav = button.dataset.nav as Screen | undefined;
      if (nav) {
        event.preventDefault();
        void this.navigate(nav);
        return;
      }

      if (action || button.dataset.matchAction) {
        event.preventDefault();
        void this.handleAction(action || "match-action", button);
      }
    });

    this.root.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target as HTMLFormElement;
      if (form.dataset.form === "join-private") {
        const code = new FormData(form).get("code");
        void this.joinPrivate(String(code || ""));
      }
    });
  }

  private async bootstrapIfAuthenticated(): Promise<void> {
    if (!this.state.snapshot.profile) return;
    this.startHeartbeat();
    await this.service.heartbeat("online").catch(() => undefined);
    const queuedMatch = await this.service.getMatchedQueueMatch().catch(() => null);
    if (queuedMatch && isLiveMatchStatus(queuedMatch.status)) {
      this.enterMatch(queuedMatch);
      return;
    }

    const match = await this.service.getCurrentMatch().catch(() => null);
    if (match && isLiveMatchStatus(match.status)) {
      this.enterMatch(match);
      return;
    }

    const roomCode = new URLSearchParams(window.location.search).get("room");
    if (roomCode) await this.resumePrivateRoom(roomCode);
  }

  private async run(label: string, task: () => Promise<void>): Promise<void> {
    this.state.loading = true;
    this.state.error = null;
    this.state.info = label;
    this.render();
    try {
      await task();
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.state.loading = false;
      this.state.info = null;
      this.render();
    }
  }

  private async navigate(screen: Screen): Promise<void> {
    this.clearPolling();
    this.clearPostMatchOverlayState();
    this.clearMatchStartRevealTimer();
    this.state.error = null;
    this.state.info = null;

    if (screen === "ranking") {
      await this.run("Carregando ranking...", async () => {
        this.state.leaderboard = await this.service.getLeaderboard();
        this.rankingTab = "leaderboard";
        this.state.screen = "ranking";
      });
      return;
    }

    if (screen === "history") {
      await this.run("Carregando historico...", async () => {
        this.state.history = await this.service.getHistory();
        this.state.screen = "history";
      });
      return;
    }

    if (screen === "profile") {
      await this.run("Carregando perfil...", async () => {
        this.state.characterUsage = await this.service.getCharacterUsage();
        this.state.screen = "profile";
      });
      return;
    }

    this.state.screen = screen;
    this.render();
  }

  private async handleAction(action: string, element: HTMLElement): Promise<void> {
    const characterId = element.dataset.character;
    const matchAction = element.dataset.matchAction;

    if (matchAction) {
      await this.submitMatchAction(matchAction as any);
      return;
    }

    switch (action) {
      case "google":
        await this.run("Abrindo login Google...", () => this.service.signInWithGoogle());
        break;
      case "logout":
        await this.run("Saindo...", async () => {
          this.stopHeartbeat();
          await this.service.signOut();
          this.state = { ...this.state, screen: "login", snapshot: emptySnapshot, match: null, room: null };
        });
        break;
      case "select-character":
        if (characterId) {
          await this.run("Salvando personagem...", async () => {
            this.state.snapshot = await this.service.selectCharacter(characterId);
            this.state.screen = "profile";
          });
        }
        break;
      case "select-match-character":
        if (characterId && this.state.match) {
          await this.run("Confirmando personagem...", async () => {
            const match = await this.service.selectMatchCharacter(this.state.match!.id, characterId);
            this.enterMatch(match);
          });
        }
        break;
      case "join-ranked":
        await this.joinRanked();
        break;
      case "cancel-queue":
        await this.run("Cancelando fila...", async () => {
          await this.service.leaveRankedQueue();
          await this.service.heartbeat("online");
          this.state.screen = "online";
        });
        break;
      case "create-private":
        await this.createPrivate();
        break;
      case "copy-room":
        if (this.state.room) {
          await navigator.clipboard.writeText(this.state.room.inviteUrl);
          this.state.info = "Link copiado.";
          this.render();
        }
        break;
      case "forfeit":
        await this.forfeit();
        break;
      case "play-again":
        await this.choosePostMatch("again");
        break;
      case "post-match-lobby":
        this.leaveFinishedMatch("online");
        break;
      case "post-match-menu":
        this.leaveFinishedMatch("menu");
        window.location.assign(legacyMainMenuUrl());
        break;
      case "legacy-menu":
        window.location.assign(legacyMainMenuUrl());
        break;
      case "ranking-leaderboard":
        this.rankingTab = "leaderboard";
        this.render();
        break;
      case "ranking-progression":
        this.rankingTab = "progression";
        this.render();
        window.requestAnimationFrame(() => {
          this.root.querySelector<HTMLElement>(".rank-tier-row.current")?.scrollIntoView({ block: "center" });
        });
        break;
    }
  }

  private async handleLegacyBattleMessage(data: unknown): Promise<void> {
    if (!data || typeof data !== "object") return;
    const message = data as Record<string, unknown>;
    if (message.source !== "final-genesis-legacy") return;

    if (message.type === "ready") {
      this.syncLegacyBattleFrameBurst();
      return;
    }

    if (message.type === "visual-busy") {
      this.markLegacyBattleVisualBusy(message);
      return;
    }

    if (message.type === "visual-ready") {
      this.markLegacyBattleVisualReady(message);
      return;
    }

    if (message.type === "battle-loaded" && typeof message.matchId === "string") {
      this.legacyBattleLoadedMatchId = message.matchId;
      await this.confirmLoadedMatchReady();
      return;
    }

    if (message.type === "action" && typeof message.action === "string") {
      const turnNumber = Number(message.turnNumber ?? message.currentTurn);
      await this.submitMatchAction(message.action as Action, Number.isFinite(turnNumber) ? turnNumber : undefined);
      return;
    }

    if (message.type === "forfeit") {
      await this.forfeit();
    }
  }

  private legacyBattleVisualKey(match: GameMatch | null = this.state.match): string | null {
    return match ? `${match.id}:${match.currentTurn}` : null;
  }

  private markLegacyBattleVisualBusy(message: Record<string, unknown>): void {
    const match = this.state.match;
    if (!match || message.matchId !== match.id || Number(message.currentTurn) !== match.currentTurn) return;

    const durationMs = Number(message.durationMs);
    const busyMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 4_000;
    this.legacyBattleVisualBusyKey = this.legacyBattleVisualKey(match);
    this.legacyBattleVisualBusyUntilMs = Date.now() + busyMs + 750;
  }

  private markLegacyBattleVisualReady(message: Record<string, unknown>): void {
    const match = this.state.match;
    if (!match || message.matchId !== match.id || Number(message.currentTurn) !== match.currentTurn) return;

    const visualKey = this.legacyBattleVisualKey(match);
    if (this.legacyBattleVisualBusyKey && this.legacyBattleVisualBusyKey !== visualKey) return;

    this.legacyBattleVisualBusyKey = null;
    this.legacyBattleVisualBusyUntilMs = 0;
    this.legacyBattleVisualReadyKey = visualKey;
    if (match.status === "resolving") {
      void this.confirmTurnReady(match);
      return;
    }
    if (match.status === "active" && hasAuthoritativeBattleStarted(match, this.serverClockOffsetMs) && !match.localAction) {
      this.syncLocalTurnClock(match, true, true);
      this.syncLegacyBattleFrame();
    }
  }

  private async confirmTurnReady(match: GameMatch): Promise<void> {
    const key = this.legacyBattleVisualKey(match);
    if (!key || match.status !== "resolving" || this.legacyBattleVisualReadyKey !== key) return;
    if (this.turnReadyRequestKey === key || this.turnReadyConfirmedKey === key) return;

    this.turnReadyRequestKey = key;
    try {
      await this.service.markTurnReady(match.id, match.currentTurn);
      this.turnReadyConfirmedKey = key;
    } catch {
      // The one-second match poll retries while this device is visually ready.
    } finally {
      if (this.turnReadyRequestKey === key) this.turnReadyRequestKey = null;
    }
  }

  private async confirmLoadedMatchReady(): Promise<void> {
    const match = this.state.match;
    if (!match || match.status !== "loading" || match.localReady || this.legacyBattleLoadedMatchId !== match.id) return;
    if (this.matchReadyRequestMatchId === match.id) return;

    this.matchReadyRequestMatchId = match.id;
    try {
      const updated = await this.service.markMatchReady(match.id);
      this.enterMatch(updated);
    } catch {
      // The one-second match poll retries while this device remains loaded.
    } finally {
      if (this.matchReadyRequestMatchId === match.id) this.matchReadyRequestMatchId = null;
    }
  }

  private isLegacyBattleVisualBusy(): boolean {
    const visualKey = this.legacyBattleVisualKey();
    return Boolean(visualKey && this.legacyBattleVisualBusyKey === visualKey && this.legacyBattleVisualBusyUntilMs > Date.now());
  }

  private isInactivityDraw(match: GameMatch): boolean {
    return match.status === "finished"
      && !match.winnerId
      && match.rankDelta === 0
      && (match.finishedReason === "inactivity_draw" || match.lastTurn?.primary === "PARTIDA ENCERRADA");
  }

  private isLoadingTimeout(match: GameMatch): boolean {
    return match.status === "finished" && match.finishedReason === "load_timeout";
  }

  private isFinishedMatch(match: GameMatch): boolean {
    return match.status === "finished" || match.status === "forfeited";
  }

  private postMatchKey(match: GameMatch): string {
    return `${match.id}:${match.currentTurn}:${match.status}:${match.winnerId || "draw"}`;
  }

  private clearPostMatchRevealTimer(): void {
    if (this.postMatchRevealTimerId) window.clearTimeout(this.postMatchRevealTimerId);
    this.postMatchRevealTimerId = null;
    this.postMatchRevealKey = null;
  }

  private clearPostMatchOverlayState(): void {
    this.clearPostMatchRevealTimer();
    this.postMatchOverlayVisibleKey = null;
  }

  private clearMatchStartRevealTimer(): void {
    if (this.matchStartRevealTimerId) window.clearTimeout(this.matchStartRevealTimerId);
    this.matchStartRevealTimerId = null;
    this.matchStartRevealKey = null;
  }

  private matchStartKey(match: GameMatch): string {
    return `${match.id}:${match.currentTurn}:${match.p1.characterId || "p1"}:${match.p2.characterId || "p2"}`;
  }

  private shouldDelayMatchStart(match: GameMatch, previousScreen: Screen): boolean {
    return previousScreen === "match-character-select"
      && match.status === "active"
      && match.currentTurn === 1
      && !match.lastTurn
      && Boolean(match.p1.characterId)
      && Boolean(match.p2.characterId);
  }

  private scheduleMatchStartReveal(match: GameMatch): void {
    const key = this.matchStartKey(match);
    if (this.matchStartRevealKey === key && this.matchStartRevealTimerId) return;

    this.clearMatchStartRevealTimer();
    this.matchStartRevealKey = key;
    this.matchStartRevealTimerId = window.setTimeout(() => {
      this.matchStartRevealTimerId = null;
      const currentMatch = this.state.match;
      if (!currentMatch || this.matchStartKey(currentMatch) !== key || currentMatch.status !== "active") return;
      this.matchStartRevealKey = null;
      this.state.screen = "battle";
      this.render();
      this.syncLegacyBattleFrameBurst();
      this.resolveExpiredTurnIfNeeded();
    }, MATCH_START_REVEAL_DELAY_MS);
  }

  private schedulePostMatchReveal(match: GameMatch): void {
    const revealKey = this.postMatchKey(match);
    if (this.postMatchOverlayVisibleKey === revealKey) {
      this.mountPostMatchOverlay();
      return;
    }

    if (this.postMatchRevealKey && this.postMatchRevealKey !== revealKey) {
      this.clearPostMatchRevealTimer();
    }

    this.postMatchRevealKey = revealKey;
    if (this.postMatchRevealTimerId) return;

    this.postMatchRevealTimerId = window.setTimeout(() => {
      this.postMatchRevealTimerId = null;
      const currentMatch = this.state.match;
      if (!currentMatch || !this.isFinishedMatch(currentMatch) || this.postMatchKey(currentMatch) !== revealKey) return;
      this.postMatchOverlayVisibleKey = revealKey;
      this.mountPostMatchOverlay();
    }, POST_MATCH_REVEAL_DELAY_MS);
  }

  private shouldDelayPostMatchReveal(match: GameMatch, previousScreen: Screen): boolean {
    return this.isFinishedMatch(match)
      && Boolean(match.lastTurn)
      && (previousScreen === "battle" || this.postMatchRevealKey === this.postMatchKey(match) || this.postMatchOverlayVisibleKey === this.postMatchKey(match));
  }

  private returnToLobbyAfterInactivityDraw(match: GameMatch): void {
    this.clearPolling();
    this.unsubscribeMatch?.();
    this.unsubscribeMatch = null;
    this.state.match = null;
    this.state.screen = "online";
    this.state.error = null;
    this.state.info = "Partida encerrada por inatividade.";
    void this.service.heartbeat("online").catch(() => undefined);
    this.render();
  }

  private returnToLobbyAfterLoadingTimeout(): void {
    this.clearPolling();
    this.unsubscribeMatch?.();
    this.unsubscribeMatch = null;
    this.legacyBattleLoadedMatchId = null;
    this.matchReadyRequestMatchId = null;
    this.legacyBattleVisualReadyKey = null;
    this.turnReadyRequestKey = null;
    this.turnReadyConfirmedKey = null;
    this.state.match = null;
    this.state.screen = "online";
    this.state.error = null;
    this.state.info = "Partida cancelada: um dos jogadores nao terminou de carregar.";
    void this.service.heartbeat("online").catch(() => undefined);
    this.render();
  }

  private async joinRanked(): Promise<void> {
    const { profile } = this.state.snapshot;
    if (!profile) return;

    await this.run("Entrando na fila ranked...", async () => {
      await this.service.heartbeat("in_queue");
      const result = await this.service.joinRankedQueue();
      if (result.match) {
        this.enterMatch(result.match);
      } else {
        this.state.screen = "ranked-queue";
        this.startMatchPolling();
      }
    });
  }

  private async createPrivate(): Promise<void> {
    await this.run("Criando sala privada...", async () => {
      this.state.room = await this.service.createPrivateRoom();
      this.state.screen = "private-room";
      this.startRoomPolling(this.state.room.code);
    });
  }

  private async joinPrivate(code: string): Promise<void> {
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) {
      this.state.error = "Digite um codigo de sala.";
      this.render();
      return;
    }

    await this.run("Entrando na sala...", async () => {
      const response = await this.service.joinPrivateRoom(normalizedCode);
      this.state.room = response.room;
      if (response.match) {
        this.enterMatch(response.match);
      } else {
        this.state.screen = "private-room";
        this.startRoomPolling(normalizedCode);
      }
    });
  }

  private async resumePrivateRoom(code: string): Promise<void> {
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) return;

    const joined = await this.service.joinPrivateRoom(normalizedCode).catch(() => null);
    if (joined) {
      this.state.room = joined.room;
      if (joined.match) {
        this.enterMatch(joined.match);
      } else {
        this.state.screen = "private-room";
        this.startRoomPolling(normalizedCode);
      }
      return;
    }

    const response = await this.service.getPrivateRoom(normalizedCode).catch(() => null);
    if (!response) return;
    this.state.room = response.room;
    if (response.match) {
      this.enterMatch(response.match);
    } else {
      this.state.screen = "private-room";
      this.startRoomPolling(normalizedCode);
    }
  }

  private displaySideFor(match: GameMatch, serverSide: Side | null): Side | null {
    if (!serverSide) return null;
    return serverSide === match.playerSide ? "p1" : "p2";
  }

  private mapGuaranteedTurn(match: GameMatch, guaranteedTurn: GuaranteedTurn | null): GuaranteedTurn | null {
    if (!guaranteedTurn) return null;
    return {
      ...guaranteedTurn,
      side: this.displaySideFor(match, guaranteedTurn.side) || "p1",
      allowedActions: [...guaranteedTurn.allowedActions],
    };
  }

  private mapBattleStateForLegacy(match: GameMatch, state: BattleState): BattleState {
    const opponentSide = oppositeSide(match.playerSide);
    return {
      p1: { ...state[match.playerSide] },
      p2: { ...state[opponentSide] },
      advantage: this.displaySideFor(match, state.advantage),
      activeGuaranteedTurn: this.mapGuaranteedTurn(match, state.activeGuaranteedTurn),
      itzcoatlResurrectionUsed: {
        p1: Boolean(state.itzcoatlResurrectionUsed?.[match.playerSide]),
        p2: Boolean(state.itzcoatlResurrectionUsed?.[opponentSide]),
      },
      ultimateHealthThresholdsReached: {
        p1: [...(state.ultimateHealthThresholdsReached?.[match.playerSide] || [])],
        p2: [...(state.ultimateHealthThresholdsReached?.[opponentSide] || [])],
      },
      turnNumber: state.turnNumber,
    };
  }

  private mapTurnForLegacy(match: GameMatch, turn: TurnResolution | null): TurnResolution | null {
    if (!turn) return null;
    const opponentSide = oppositeSide(match.playerSide);
    const localIsP1 = match.playerSide === "p1";
    return {
      ...turn,
      winner: this.displaySideFor(match, turn.winner),
      loser: this.displaySideFor(match, turn.loser),
      damaged: turn.damaged.map((side) => this.displaySideFor(match, side)).filter((side): side is Side => Boolean(side)),
      healed: (turn.healed || []).map((side) => this.displaySideFor(match, side)).filter((side): side is Side => Boolean(side)),
      healing: Object.fromEntries(
        Object.entries(turn.healing || {})
          .map(([side, amount]) => [this.displaySideFor(match, side as Side), amount])
          .filter(([side]) => Boolean(side)),
      ) as Partial<Record<Side, number>>,
      knockedDown: turn.knockedDown.map((side) => this.displaySideFor(match, side)).filter((side): side is Side => Boolean(side)),
      guaranteedTurn: this.mapGuaranteedTurn(match, turn.guaranteedTurn),
      p1Action: localIsP1 ? turn.p1Action : turn.p2Action,
      p2Action: localIsP1 ? turn.p2Action : turn.p1Action,
      before: this.mapBattleStateForLegacy(match, turn.before),
      after: this.mapBattleStateForLegacy(match, turn.after),
      matchWinner: this.displaySideFor(match, turn.matchWinner),
    };
  }

  private legacyBattlePayload(match: GameMatch): Record<string, unknown> | null {
    const localCharacterId = match[match.playerSide].characterId;
    const opponentSide = oppositeSide(match.playerSide);
    const opponentCharacterId = match[opponentSide].characterId;
    if (!localCharacterId || !opponentCharacterId) return null;
    const localTurnDeadlineMs = this.localTurnDeadlineMs;
    const waitingForAuthoritativeStart = match.status === "loading"
      || (match.status === "active" && !hasAuthoritativeBattleStarted(match, this.serverClockOffsetMs));
    const usesLocalDeadline = localTurnDeadlineMs !== null && !waitingForAuthoritativeStart;
    const turnDeadlineAt = usesLocalDeadline
      ? new Date(localTurnDeadlineMs).toISOString()
      : match.turnDeadlineAt;
    const serverNow = usesLocalDeadline ? new Date().toISOString() : match.serverNow;

    return {
      source: "final-genesis-online",
      type: "sync",
      matchId: match.id,
      status: match.status,
      localName: match[match.playerSide].displayName,
      opponentName: match[opponentSide].displayName,
      localCharacterId,
      opponentCharacterId,
      battleState: this.mapBattleStateForLegacy(match, match.battleState),
      currentTurn: match.currentTurn,
      turnDeadlineAt,
      serverNow,
      localReady: match.localReady,
      opponentReady: match.opponentReady,
      loadingDeadlineAt: match.loadingDeadlineAt,
      battleStartAt: match.battleStartAt,
      turnDurationMs: turnDurationForState(match.battleState),
      localAction: match.localAction,
      opponentHasAction: match.opponentHasAction,
      lastTurn: this.mapTurnForLegacy(match, match.lastTurn),
      winnerId: match.winnerId,
    };
  }

  private syncLegacyBattleFrame(): void {
    const match = this.state.match;
    if (!match || (this.state.screen !== "battle" && this.state.screen !== "post-match")) return;
    const frame = this.root.querySelector<HTMLIFrameElement>("[data-legacy-online-battle]");
    const payload = this.legacyBattlePayload(match);
    if (!frame?.contentWindow || !payload) return;
    frame.contentWindow.postMessage(payload, window.location.origin);
  }

  private resetLegacyPendingAction(matchId: string, turnNumber: number, errorMessage?: string): void {
    const frame = this.root.querySelector<HTMLIFrameElement>("[data-legacy-online-battle]");
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage({
      source: "final-genesis-online",
      type: "action-reset",
      matchId,
      turnNumber,
      errorMessage: errorMessage?.slice(0, 140) || null,
    }, window.location.origin);
  }

  private syncLegacyBattleFrameBurst(): void {
    [0, 100, 300, 700, 1_200, 2_000].forEach((delayMs) => {
      window.setTimeout(() => this.syncLegacyBattleFrame(), delayMs);
    });
  }

  private enterMatch(match: GameMatch): void {
    if (this.isLoadingTimeout(match)) {
      this.returnToLobbyAfterLoadingTimeout();
      return;
    }
    if (this.isInactivityDraw(match)) {
      this.returnToLobbyAfterInactivityDraw(match);
      return;
    }

    const previousScreen = this.state.screen;
    const previousMatchId = this.state.match?.id || null;
    const previousBattleMatchId = previousScreen === "battle" ? this.state.match?.id : null;
    if (previousMatchId !== match.id) {
      this.legacyBattleLoadedMatchId = null;
      this.matchReadyRequestMatchId = null;
      this.legacyBattleVisualReadyKey = null;
      this.turnReadyRequestKey = null;
      this.turnReadyConfirmedKey = null;
    }
    this.clearPolling();
    if (match.serverNow) {
      this.serverClockOffsetMs = Date.now() - new Date(match.serverNow).getTime();
    }
    this.syncLocalTurnClock(match);
    this.state.match = match;
    if (!this.isFinishedMatch(match)) {
      this.clearPostMatchOverlayState();
    }
    if (this.shouldDelayPostMatchReveal(match, previousScreen)) {
      this.clearMatchStartRevealTimer();
      this.state.screen = "battle";
      this.schedulePostMatchReveal(match);
    } else if (this.shouldDelayMatchStart(match, previousScreen)) {
      this.state.screen = "match-character-select";
      this.scheduleMatchStartReveal(match);
    } else {
      this.clearMatchStartRevealTimer();
      this.state.screen = this.isFinishedMatch(match) ? "post-match" : match.status === "selecting" ? "match-character-select" : "battle";
    }
    this.unsubscribeMatch?.();
    this.unsubscribeMatch = this.service.watchMatch(match.id, () => {
      void this.refreshMatch();
    });
    if (this.state.screen === "battle" || this.state.screen === "match-character-select" || this.state.screen === "post-match") {
      this.pollId = window.setInterval(() => {
        void this.refreshMatch().catch(() => undefined);
      }, 1_000);
    }
    void this.service.heartbeat("in_match", match.id);
    if (this.state.screen === "battle") {
      if (previousBattleMatchId !== match.id) {
        if (match.status !== "loading" && !match.battleStartAt) {
          this.legacyBattleVisualBusyKey = this.legacyBattleVisualKey(match);
          this.legacyBattleVisualBusyUntilMs = Date.now() + 10_000;
        } else {
          this.legacyBattleVisualBusyKey = null;
          this.legacyBattleVisualBusyUntilMs = 0;
        }
      }
      this.syncLegacyBattleFrameBurst();
      void this.confirmLoadedMatchReady();
      void this.confirmTurnReady(match);
    }
    this.resolveExpiredTurnIfNeeded();
  }

  private async refreshMatch(): Promise<void> {
    const currentMatchId = this.state.match?.id;
    const match = currentMatchId ? await this.service.getMatch(currentMatchId) : await this.service.getCurrentMatch();
    if (match) {
      if (match.rematch?.nextMatchId && this.isFinishedMatch(match)) {
        const nextMatch = await this.service.getMatch(match.rematch.nextMatchId).catch(() => null);
        if (nextMatch && isLiveMatchStatus(nextMatch.status)) {
          this.enterMatch(nextMatch);
          return;
        }
      }

      if (this.isLoadingTimeout(match)) {
        this.returnToLobbyAfterLoadingTimeout();
        return;
      }

      if (this.isInactivityDraw(match)) {
        this.returnToLobbyAfterInactivityDraw(match);
        return;
      }

      const previousScreen = this.state.screen;
      if (match.serverNow) {
        this.serverClockOffsetMs = Date.now() - new Date(match.serverNow).getTime();
      }
      this.syncLocalTurnClock(match);
      this.state.match = match;
      if (this.isFinishedMatch(match)) {
        if (this.shouldDelayPostMatchReveal(match, previousScreen)) {
          this.state.screen = "battle";
          this.schedulePostMatchReveal(match);
        } else {
          if (this.pollId) window.clearInterval(this.pollId);
          this.pollId = null;
          this.state.screen = "post-match";
        }
      } else if (match.status === "selecting") {
        this.clearMatchStartRevealTimer();
        this.clearPostMatchOverlayState();
        this.state.screen = "match-character-select";
      } else if (match.status === "loading" || match.status === "active" || match.status === "resolving") {
        this.clearPostMatchOverlayState();
        if (this.shouldDelayMatchStart(match, previousScreen)) {
          this.state.screen = "match-character-select";
          this.scheduleMatchStartReveal(match);
        } else {
          this.clearMatchStartRevealTimer();
          this.state.screen = "battle";
        }
      }
      if (this.state.screen === "battle") void this.confirmLoadedMatchReady();
      if (previousScreen === "battle" && this.state.screen === "battle") {
        this.syncLegacyBattleFrame();
      } else {
        this.render();
      }
      this.resolveExpiredTurnIfNeeded();
    }
  }

  private async submitMatchAction(action: Action, turnNumber = this.state.match?.currentTurn): Promise<void> {
    const currentMatch = this.state.match;
    if (!currentMatch || !canForwardOnlineAction(currentMatch)) return;
    const requestedTurn = turnNumber ?? currentMatch.currentTurn;
    const requestKey = `${currentMatch.id}:${requestedTurn}`;
    if (this.matchActionRequestKey === requestKey) return;

    this.matchActionRequestKey = requestKey;
    this.state.error = null;
    let lastError: unknown = null;

    try {
      for (const delayMs of ACTION_SUBMIT_RETRY_DELAYS_MS) {
        const latestMatch = this.state.match;
        if (
          !latestMatch
          || latestMatch.id !== currentMatch.id
          || latestMatch.status !== "active"
          || latestMatch.currentTurn !== requestedTurn
        ) {
          return;
        }

        if (delayMs > 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
        }

        try {
          // The server is authoritative about battle_start_at. Rechecking that instant
          // here can silently discard a click when the iframe and parent clocks differ.
          const match = await this.service.submitAction(currentMatch.id, action, requestedTurn);
          if (!match) return;
          this.enterMatch(match);

          const actionWasAccepted = match.id === currentMatch.id
            && (match.status !== "active" || match.currentTurn !== requestedTurn || Boolean(match.localAction));
          if (actionWasAccepted) return;

          // A response before the shared start can legitimately contain no action.
          // Keep the local choice pending and retry after both clocks cross the gate.
          lastError = null;
        } catch (error) {
          lastError = error;
          if (!isRetryableOnlineActionError(error)) break;
        }
      }

      if (lastError) {
        this.state.error = lastError instanceof Error ? lastError.message : String(lastError);
        console.error("[online-action] submit failed", this.state.error);
      }
      this.resetLegacyPendingAction(currentMatch.id, requestedTurn, this.state.error || "Acao nao confirmada pelo servidor.");
      void this.refreshMatch().catch(() => undefined);
    } finally {
      if (this.matchActionRequestKey === requestKey) this.matchActionRequestKey = null;
    }
  }

  private async forfeit(): Promise<void> {
    if (!this.state.match) return;
    await this.run("Abandonando partida...", async () => {
      const match = await this.service.forfeitMatch(this.state.match!.id);
      this.enterMatch(match);
    });
  }

  private async choosePostMatch(choice: RematchChoice): Promise<void> {
    const match = this.state.match;
    if (!match || !["finished", "forfeited"].includes(match.status)) return;

    await this.run(choice === "again" ? "Aguardando revanche..." : "Voltando ao lobby...", async () => {
      const updated = await this.service.postMatchChoice(match.id, choice);
      if (isLiveMatchStatus(updated.status)) {
        this.enterMatch(updated);
        return;
      }

      this.state.match = updated;
      this.state.screen = "post-match";
      if (choice === "again" && !this.pollId) {
        this.pollId = window.setInterval(() => {
          void this.refreshMatch().catch(() => undefined);
        }, 1_000);
      }
    });
  }

  private leaveFinishedMatch(destination: "online" | "menu"): void {
    const match = this.state.match;
    this.clearPolling();
    this.unsubscribeMatch?.();
    this.unsubscribeMatch = null;
    this.clearPostMatchOverlayState();
    this.clearMatchStartRevealTimer();
    this.state.match = null;
    this.state.error = null;
    this.state.info = null;
    if (destination === "online") {
      this.state.screen = "online";
      void this.service.heartbeat("online").catch(() => undefined);
      this.render();
    }
    if (match && this.isFinishedMatch(match)) {
      void this.service.postMatchChoice(match.id, "lobby").catch(() => undefined);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatId = window.setInterval(() => {
      const status = this.state.screen === "ranked-queue" ? "in_queue" : this.state.screen === "battle" || this.state.screen === "match-character-select" ? "in_match" : "online";
      void this.service.heartbeat(status, this.state.match?.id).catch(() => undefined);
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatId) window.clearInterval(this.heartbeatId);
    this.heartbeatId = null;
  }

  private startMatchPolling(): void {
    this.clearPolling();
    const userId = this.state.snapshot.profile?.id;
    const pollMatch = async () => {
      const queuedMatch = await this.service.getMatchedQueueMatch().catch(() => null);
      const match = queuedMatch || (await this.service.getCurrentMatch().catch(() => null));
      if (match && isLiveMatchStatus(match.status)) this.enterMatch(match);
    };

    if (userId) {
      this.unsubscribeRankedQueue = this.service.watchRankedQueue(userId, () => {
        void pollMatch();
      });
    }
    void pollMatch();
    this.pollId = window.setInterval(pollMatch, 1_000);
  }

  private startRoomPolling(code: string): void {
    this.clearPolling();
    const pollRoom = async () => {
      const response = await this.service.getPrivateRoom(code).catch(() => null);
      if (!response) return;

      this.state.room = response.room;
      if (response.match?.matchType === "private" && isLiveMatchStatus(response.match.status)) {
        this.enterMatch(response.match);
        return;
      }

      if (this.state.screen === "private-room") this.render();
    };

    this.unsubscribePrivateRoom = this.service.watchPrivateRoom(code, () => {
      void pollRoom();
    });
    void pollRoom();
    this.pollId = window.setInterval(pollRoom, 2_000);
  }

  private clearPolling(): void {
    if (this.pollId) window.clearInterval(this.pollId);
    this.pollId = null;
    this.unsubscribeRankedQueue?.();
    this.unsubscribeRankedQueue = null;
    this.unsubscribePrivateRoom?.();
    this.unsubscribePrivateRoom = null;
  }

  private render(): void {
    const usesBattleStage = this.state.screen === "battle" || this.state.screen === "post-match";
    const usesMatchSelectStage = this.state.screen === "match-character-select";
    const shellClasses = [
      "app-shell",
      usesMobileStage(this.state.screen) ? "mobile-stage-shell" : "",
      usesBattleStage ? "battle-app-shell" : "",
      usesMatchSelectStage ? "match-select-app-shell" : "",
    ].filter(Boolean).join(" ");

    this.root.innerHTML = `
      <main class="${shellClasses}">
        ${this.state.snapshot.profile && !usesBattleStage ? this.renderTopBar() : ""}
        <div class="app-content">
          ${usesBattleStage ? "" : this.renderStatus()}
          ${this.renderScreen()}
        </div>
        ${this.renderLoadingOverlay()}
      </main>
    `;
    this.bindRenderedControls();
    this.syncLegacyBattleFrame();
    this.startUiTimer();
    this.syncRouteRefresh();
  }

  private syncRouteRefresh(): void {
    const url = new URL(window.location.href);

    if (!this.initialBootstrapComplete && url.searchParams.has("room")) return;

    if (this.state.snapshot.profile && url.pathname.startsWith("/auth/callback")) {
      url.pathname = "/online/index.html";
      url.search = "";
      url.hash = "";
      window.history.replaceState(null, "", url.href);
    }

    if (this.state.screen === "private-room" && this.state.room?.code) {
      url.pathname = "/online/index.html";
      url.search = "";
      url.searchParams.set("room", this.state.room.code);
      if (window.location.href !== url.href) window.history.replaceState(null, "", url.href);
      return;
    }

    if (url.searchParams.has("room")) {
      url.searchParams.delete("room");
      window.history.replaceState(null, "", url.href);
    }
  }

  private bindRenderedControls(): void {
    this.root.querySelectorAll<HTMLIFrameElement>("[data-legacy-online-battle]").forEach((frame) => {
      frame.addEventListener("load", () => this.syncLegacyBattleFrameBurst());
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-match-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const action = button.dataset.matchAction as Action | undefined;
        if (action) void this.submitMatchAction(action);
      });
    });
  }

  private startUiTimer(): void {
    if (this.timerId) window.clearInterval(this.timerId);
    this.timerId = window.setInterval(() => {
      const clock = this.root.querySelector<HTMLElement>("[data-turn-clock]");
      if (clock && this.state.match?.turnDeadlineAt) {
        clock.textContent = countdown(this.state.match.turnDeadlineAt, this.serverClockOffsetMs);
      }
      if (this.state.screen === "battle" && this.state.match?.status === "active") {
        this.resolveExpiredTurnIfNeeded();
      }
    }, 250);
  }

  private resolveExpiredTurnIfNeeded(): void {
    if (!this.state.match || this.state.screen !== "battle" || !["active", "resolving"].includes(this.state.match.status)) return;
    if (!this.state.match.turnDeadlineAt || !hasAuthoritativeBattleStarted(this.state.match, this.serverClockOffsetMs)) return;
    if (this.isLegacyBattleVisualBusy()) return;
    const serverDeadlineMs = new Date(this.state.match.turnDeadlineAt).getTime() + this.serverClockOffsetMs + ACTION_SUBMIT_GRACE_MS;
    const deadlineMs = Math.max(serverDeadlineMs, this.localTurnDeadlineMs ?? 0);
    if (this.state.match.status === "resolving" || deadlineMs <= Date.now()) {
      void this.resolveExpiredTurn();
    }
  }

  private syncLocalTurnClock(match: GameMatch, force = false, restartFromNow = false): void {
    const key = `${match.id}:${match.currentTurn}:${match.turnDeadlineAt}:${match.status}`;
    if (!force && this.turnClockKey === key && this.localTurnDeadlineMs !== null) return;

    this.turnClockKey = key;
    if ((match.status !== "active" && match.status !== "resolving") || !match.turnDeadlineAt) {
      this.localTurnDeadlineMs = null;
      return;
    }
    if (match.status === "active" && !hasAuthoritativeBattleStarted(match, this.serverClockOffsetMs)) {
      this.localTurnDeadlineMs = null;
      return;
    }

    this.localTurnDeadlineMs = calculateLocalTurnDeadlineMs(
      match.turnDeadlineAt,
      match.battleState,
      this.serverClockOffsetMs,
      restartFromNow,
    );
  }

  private async resolveExpiredTurn(): Promise<void> {
    if (!this.state.match || this.resolvingExpiredTurn) return;
    this.resolvingExpiredTurn = true;
    try {
      const match = await this.service.resolveTurn(this.state.match.id);
      this.enterMatch(match);
    } catch {
      // Polling will retry; avoid flashing errors for timer-driven resolution.
    } finally {
      this.resolvingExpiredTurn = false;
    }
  }

  private renderTopBar(): string {
    const { profile, rank } = this.state.snapshot;
    if (!profile) return "";

    const firstHigherRuleIndex = rank
      ? RANK_RULES.findIndex((rule) => rank.rankPoints < rule.minimumPoints)
      : 1;
    const currentRuleIndex = firstHigherRuleIndex === -1
      ? RANK_RULES.length - 1
      : Math.max(0, firstHigherRuleIndex - 1);
    const currentRule = RANK_RULES[currentRuleIndex];
    const nextRule = RANK_RULES[currentRuleIndex + 1] ?? null;
    const progress = rank && nextRule
      ? Math.max(0, Math.min(100, ((rank.rankPoints - currentRule.minimumPoints) / (nextRule.minimumPoints - currentRule.minimumPoints)) * 100))
      : 100;
    const pointsRemaining = rank && nextRule ? Math.max(0, nextRule.minimumPoints - rank.rankPoints) : 0;

    return `
      <header class="top-bar">
        <button class="brand-button" data-nav="menu" type="button">
          <img src="/game-assets/ui/menu/logo.webp" alt="Final Genesis">
        </button>
        <div class="player-chip rank-hud">
          <div class="rank-hud-heading">
            <span class="rank-player-identity">
              <span class="presence-dot ${profile.presenceStatus}"></span>
              <strong class="player-chip-name">${escapeHtml(profile.displayName)}</strong>
            </span>
            ${rank ? `<b class="rank-current-points">${rank.rankPoints} pts</b>` : ""}
          </div>
          ${rank ? `
            <div class="rank-progress-labels">
              <span>${currentRule.division}</span>
              <span>${nextRule ? nextRule.division : "Ranking máximo"}</span>
            </div>
            <div class="rank-progress-track" role="progressbar" aria-label="Progresso no ranking" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}">
              <span class="rank-progress-fill" style="width: ${progress.toFixed(2)}%"></span>
            </div>
            <div class="rank-hud-stats">
              <span>${nextRule ? `<b>${pointsRemaining}</b> pts para subir` : `<b>Primordial</b> alcançado`}</span>
              <span><b>${rank.wins}</b> ${rank.wins === 1 ? "vitória" : "vitórias"}</span>
              <span><b>${rank.streak}</b> sequência</span>
            </div>
          ` : ""}
        </div>
      </header>
    `;
  }

  private renderStatus(): string {
    return `
      ${this.state.error ? `<div class="banner error">${escapeHtml(this.state.error)}</div>` : ""}
      ${this.state.info && !this.state.loading ? `<div class="banner info">${escapeHtml(this.state.info)}</div>` : ""}
    `;
  }

  private renderLoadingOverlay(): string {
    if (!this.state.loading) return "";
    return `
      <section class="loading-overlay" role="status" aria-live="polite" aria-label="${escapeHtml(this.state.info || "Carregando...")}">
        <img class="loading-spinner" src="/game-assets/ui/loading/loading-spinner.webp?v=20260622-key2" alt="">
        <div class="loading-text">${escapeHtml(this.state.info || "Carregando...")}</div>
      </section>
    `;
  }

  private renderScreen(): string {
    if (!this.state.snapshot.profile) return this.renderLogin();

    switch (this.state.screen) {
      case "profile":
        return this.renderProfile();
      case "character-select":
        return this.renderCharacterSelect();
      case "online":
        return this.renderOnlineLobby();
      case "ranked-queue":
        return this.renderRankedQueue();
      case "private-room":
        return this.renderPrivateRoom();
      case "match-character-select":
        return this.renderMatchCharacterSelect();
      case "battle":
        return this.renderBattle();
      case "post-match":
        return this.renderPostMatchBattle();
      case "ranking":
        return this.renderRanking();
      case "history":
        return this.renderHistory();
      default:
        return this.renderMenu();
    }
  }

  private renderLogin(): string {
    return `
      <section class="login-screen">
        <div class="login-hero">
          <img src="/game-assets/ui/menu/logo.webp" alt="Final Genesis" class="login-logo">
          <div class="login-actions">
            <button class="primary-command" data-action="google" type="button">Entrar com Google</button>
          </div>
          <p class="login-note">Online exige conta Google.</p>
        </div>
      </section>
    `;
  }

  private renderMenu(): string {
    return `
      <section class="menu-screen">
        <nav class="main-actions" aria-label="Menu principal">
          <button class="image-command online" data-nav="online" type="button">Jogar Online</button>
          <button class="image-command ranking" data-nav="ranking" type="button">Ranking</button>
          <button class="image-command profile" data-nav="profile" type="button">Perfil</button>
        </nav>
        <nav class="mobile-bottom-actions menu-bottom-actions" aria-label="Navegacao">
          <button class="danger-command simple-back-command" data-action="legacy-menu" type="button">Voltar</button>
        </nav>
      </section>
    `;
  }

  private renderProfile(): string {
    const { profile, rank } = this.state.snapshot;
    if (!profile || !rank) return "";
    const mostUsed = mostUsedCharacter(this.state.characterUsage, profile.selectedCharacterId);
    const selected = mostUsed.character;
    return `
      <section class="screen-band profile-screen">
        <div class="section-heading">
          <h1>Perfil</h1>
        </div>
        <div class="profile-layout">
          <div class="profile-panel">
            <img class="profile-avatar" src="${selected.portraitUrl}" alt="">
            <div>
              <h2>${escapeHtml(profile.displayName)}</h2>
              <p>Conta Google</p>
              <p>${rank.division} · ${rank.rankPoints} pontos · streak ${rank.streak}</p>
            </div>
          </div>
          <div class="stats-grid">
            <span><strong>${rank.wins}</strong> Vitorias</span>
            <span><strong>${rank.losses}</strong> Derrotas</span>
            <span><strong>${rank.bestStreak}</strong> Melhor streak</span>
            <span class="favorite-character-stat"><strong>${selected.name}</strong>${mostUsed.matches > 0 ? `Mais utilizado<small>${mostUsed.matches} ${mostUsed.matches === 1 ? "partida" : "partidas"}</small>` : "Sem partidas"}</span>
          </div>
          <div class="button-row">
            <button class="ghost-command profile-logout-command" data-action="logout" type="button">Desconectar da conta Google</button>
          </div>
        </div>
        <nav class="mobile-bottom-actions" aria-label="Navegacao">
          <button class="danger-command simple-back-command" data-nav="menu" type="button">Voltar</button>
        </nav>
      </section>
    `;
  }

  private renderCharacterSelect(): string {
    const unlocked = new Set(this.state.snapshot.unlockedCharacterIds);
    const selectedId = this.state.snapshot.profile?.selectedCharacterId;
    return `
      <section class="screen-band character-screen">
        <div class="section-heading">
          <h1>Selecionar personagem</h1>
          <button class="ghost-command" data-nav="profile" type="button">Voltar</button>
        </div>
        <div class="character-grid-app">
          ${characters.filter((character) => character.enabled).map((character) => {
            const available = character.enabled && unlocked.has(character.id);
            return `
              <button class="fighter-card ${selectedId === character.id ? "selected" : ""} ${available ? "" : "locked"}" data-action="select-character" data-character="${character.id}" ${available ? "" : "disabled"} type="button">
                <img src="${character.portraitUrl}" alt="">
                <span>${escapeHtml(character.name)}</span>
                <small>${available ? (selectedId === character.id ? "Selecionado" : "Disponivel") : character.unlockDescription}</small>
              </button>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  private renderOnlineLobby(): string {
    return `
      <section class="screen-band online-lobby-screen">
        <div class="section-heading">
          <h1>Online</h1>
        </div>
        <div class="mobile-scroll-body">
          <div class="online-grid">
            <article class="mode-panel">
              <h2>Partida Ranked</h2>
              <p>Procura adversario automaticamente, atualiza divisao, pontos e streak.</p>
              <button class="primary-command" data-action="join-ranked" type="button">Entrar na fila</button>
            </article>
            <article class="mode-panel">
              <h2>Partida Privada</h2>
              <p>Crie um codigo/link para jogar sem alterar ranking.</p>
              <button class="secondary-command" data-action="create-private" type="button">Criar sala</button>
              <form class="join-form" data-form="join-private">
                <input name="code" inputmode="text" autocomplete="off" placeholder="CODIGO">
                <button class="secondary-command" type="submit">Entrar</button>
              </form>
            </article>
          </div>
        </div>
        <nav class="mobile-bottom-actions" aria-label="Navegacao">
          <button class="danger-command simple-back-command" data-nav="menu" type="button">Voltar</button>
        </nav>
      </section>
    `;
  }

  private renderRankedQueue(): string {
    return `
      <section class="queue-screen">
        <div class="queue-pulse"></div>
        <h1>Procurando adversario</h1>
        <p>Quando a partida for encontrada, os dois jogadores escolhem personagem.</p>
        <button class="danger-command" data-action="cancel-queue" type="button">Cancelar fila</button>
      </section>
    `;
  }

  private renderPrivateRoom(): string {
    const room = this.state.room;
    if (!room) return "";
    return `
      <section class="screen-band private-room-screen">
        <div class="section-heading">
          <h1>Sala privada</h1>
        </div>
        <div class="mobile-scroll-body">
        <div class="room-panel">
          <span class="room-code">${escapeHtml(room.code)}</span>
          <p>Envie este codigo ou link para o adversario entrar.</p>
          <p>Host: ${escapeHtml(room.hostName)} · Visitante: ${room.guestName ? escapeHtml(room.guestName) : "aguardando"}</p>
          <div class="button-row">
            <button class="secondary-command" data-action="copy-room" type="button">Copiar link</button>
          </div>
        </div>
        </div>
        <nav class="mobile-bottom-actions" aria-label="Navegacao">
          <button class="image-back-command menu-back" data-nav="online" type="button">Voltar</button>
        </nav>
      </section>
    `;
  }

  private renderMatchCharacterSelect(): string {
    const match = this.state.match;
    if (!match) return "";

    const unlocked = new Set(this.state.snapshot.unlockedCharacterIds);
    const localSide = match.playerSide;
    const opponentSide = oppositeSide(localSide);
    const localPlayer = match[localSide];
    const opponentPlayer = match[opponentSide];
    const localSelected = localPlayer.characterId !== null;
    const opponentSelected = opponentPlayer.characterId !== null;
    const matchReady = match.status === "active" && localSelected && opponentSelected;
    const localCharacter = localPlayer.characterId ? characterById(localPlayer.characterId) : null;
    const opponentCharacter = opponentPlayer.characterId ? characterById(opponentPlayer.characterId) : null;
    const previewCharacter = localCharacter || characterById(this.state.snapshot.profile?.selectedCharacterId || "ninja");
    const previewClass = characterVisualClass(previewCharacter.id);

    return `
      <section class="match-select-screen">
        <img class="character-select-title-art" src="/game-assets/ui/menu/logo.webp" alt="Final Genesis" draggable="false">
        <img class="character-select-subtitle-art" src="/game-assets/ui/character-select/subtitle.webp" alt="Escolha seu lutador" draggable="false">
        <div class="match-select-status">
          <div class="select-player-chip ready">
            <span>${escapeHtml(localPlayer.displayName)}</span>
            <strong>${localCharacter ? escapeHtml(localCharacter.name) : "Escolhendo"}</strong>
          </div>
          <div class="select-player-chip ${opponentSelected ? "ready" : ""}">
            <span>${escapeHtml(opponentPlayer.displayName)}</span>
            <strong>${opponentCharacter ? escapeHtml(opponentCharacter.name) : "Aguardando"}</strong>
          </div>
        </div>
        ${matchReady ? `<div class="match-starting-status" role="status" aria-live="polite">Luta comecando...</div>` : ""}
        <div class="character-preview-stage" aria-hidden="true">
          <img class="character-preview-art ${previewClass}" src="${previewCharacter.portraitUrl}" alt="" draggable="false">
        </div>
        <div class="character-grid match-character-grid" role="list" aria-label="Lutadores">
          ${characters.filter((character) => character.enabled).map((character) => {
            const available = character.enabled && unlocked.has(character.id);
            const selected = localPlayer.characterId === character.id;
            const opponentPicked = opponentPlayer.characterId === character.id;
            const visualClass = characterVisualClass(character.id);
            return `
              <button class="character-card ${selected ? `is-selected is-${localSide}-selected` : ""} ${opponentPicked ? `is-${opponentSide}-selected` : ""} ${available ? "" : "is-locked"}" data-action="select-match-character" data-character="${character.id}" ${available && !localSelected ? "" : "disabled"} type="button" role="listitem" aria-pressed="${selected ? "true" : "false"}" ${available ? "" : "aria-disabled=\"true\""}>
                <span class="character-card-frame" aria-hidden="true"></span>
                <span class="character-selection-badge p1" aria-hidden="true">P1</span>
                <span class="character-selection-badge p2" aria-hidden="true">P2</span>
                <span class="character-portrait-window" aria-hidden="true">
                  <img class="character-art ${visualClass}" src="${character.portraitUrl}" alt="" draggable="false">
                </span>
                <span class="character-nameplate"><span>${escapeHtml(character.name)}</span></span>
              </button>
            `;
          }).join("")}
        </div>
        <nav class="character-select-actions" aria-label="Acoes da selecao de personagem">
          <button class="character-select-button back" data-action="forfeit" type="button">Abandonar</button>
        </nav>
      </section>
    `;
  }

  private renderBattle(): string {
    const match = this.state.match;
    if (!match) return "";
    return `
      <section class="legacy-online-battle-screen">
        ${this.renderLegacyBattleFrame()}
      </section>
    `;
  }

  private renderLegacyBattleFrame(): string {
    return `
      <iframe
        class="legacy-online-battle-frame"
        data-legacy-online-battle
        src="${appRouteUrl("prototype/mobile-layout/?onlineBridge=1&v=20260710-action-error-feedback")}"
        title="Batalha online Final Genesis"
      ></iframe>
    `;
  }

    /*
    const localSide = match.playerSide;
    const opponentSide = oppositeSide(localSide);
    const localPlayer = match[localSide];
    const opponentPlayer = match[opponentSide];
    const localCharacter = characterById(localPlayer.characterId || "ninja");
    const opponentCharacter = characterById(opponentPlayer.characterId || "ninja");
    const playerState = match.battleState[localSide];
    const opponentState = match.battleState[opponentSide];
    const canAct = match.status === "active" && !match.localAction;
    return `
      <section class="battle-screen">
        <div class="battle-hud">
          ${this.renderFighterHud(localPlayer.displayName, localCharacter.portraitUrl, playerState.health, playerState.super)}
          <div class="round-clock" data-turn-clock>${countdown(match.turnDeadlineAt, this.serverClockOffsetMs)}</div>
          ${this.renderFighterHud(opponentPlayer.displayName, opponentCharacter.portraitUrl, opponentState.health, opponentState.super)}
        </div>
        <div class="arena">
          <img class="fighter-art left" src="${localCharacter.portraitUrl}" alt="">
          <div class="versus-column">
            <span>${match.lastTurn ? escapeHtml(match.lastTurn.primary) : "READY"}</span>
            <small>${match.localAction ? "Voce escolheu" : "Escolha sua acao"} · ${match.opponentHasAction ? "adversario escolheu" : "aguardando adversario"}</small>
          </div>
          <img class="fighter-art right" src="${opponentCharacter.portraitUrl}" alt="">
        </div>
        <div class="action-grid">
          ${selectableActions.map((action) => {
            const disabled = !canAct || (action === "Super" && playerState.super < 3);
            return `<button class="action-button" data-match-action="${action}" ${disabled ? "disabled" : ""} type="button">${action === "Super" ? "ULTIMATE" : action.toUpperCase()}</button>`;
          }).join("")}
        </div>
        <div class="battle-footer">
          <button class="danger-command" data-action="forfeit" type="button">Abandonar</button>
        </div>
      </section>
    `;
  }

    */
  private renderFighterHud(name: string, portrait: string, health: number, superValue: number): string {
    return `
      <div class="fighter-hud-app">
        <img src="${portrait}" alt="">
        <div>
          <strong>${escapeHtml(name)}</strong>
          <div class="health-track"><span style="width:${health}%"></span></div>
          <small>HP ${health}% · ULT ${superValue}/3</small>
        </div>
      </div>
    `;
  }

  private renderRematchButton(match: GameMatch): string {
    const rematch = match.rematch || { localChoice: null, opponentChoice: null, nextMatchId: null };
    const opponentLeft = rematch.opponentChoice === "lobby";
    const localReady = !opponentLeft && rematch.localChoice === "again";
    const opponentReady = !opponentLeft && rematch.opponentChoice === "again";
    if (opponentLeft || localReady) {
      const label = opponentLeft ? "Adversario saiu" : "Aguardando...";
      return `<div class="rematch-status" role="status" aria-live="polite">${label}</div>`;
    }

    const label = opponentReady ? "Aceitar revanche" : "Jogar novamente";

    return `
      <button class="primary-command rematch-command" data-action="play-again" type="button">
        <span class="rematch-badges" aria-hidden="true">
          ${opponentReady ? `<span class="rematch-badge p2">P2</span>` : ""}
        </span>
        <span>${label}</span>
      </button>
    `;
  }

  private mountPostMatchOverlay(): void {
    const match = this.state.match;
    if (!match || !this.state.snapshot.profile) return;
    const battleScreen = this.root.querySelector<HTMLElement>(".legacy-online-battle-screen");
    if (!battleScreen) {
      this.render();
      return;
    }

    battleScreen.classList.add("post-match-battle-screen");
    battleScreen.querySelectorAll(".post-match-scrim, .post-match-result").forEach((element) => element.remove());
    battleScreen.insertAdjacentHTML("beforeend", this.renderPostMatchOverlay());
  }

  private renderPostMatchOverlay(): string {
    const match = this.state.match;
    const profile = this.state.snapshot.profile;
    if (!match || !profile) return "";

    const playerWon = match.winnerId === profile.id;
    const privateScore = match.privateScore;
    const title = playerWon ? "VOCE VENCEU" : match.winnerId ? "VOCE PERDEU" : "EMPATE";
    const rankDelta = match.rankDelta >= 0 ? `+${match.rankDelta}` : String(match.rankDelta);

    return `
        <div class="post-match-scrim" aria-hidden="true"></div>
        <div class="post-match-result" role="status" aria-live="polite">
          <h1>${title}</h1>
          <div class="post-match-summary">
            ${match.matchType === "ranked" ? `<p>${rankDelta} pontos</p><span>Streak atualizado</span>` : ""}
            ${privateScore ? `<p>Placar privado ${privateScore.playerWins} x ${privateScore.opponentWins}</p>` : ""}
          </div>
          <nav class="post-match-actions" aria-label="Acoes da partida">
            ${this.renderRematchButton(match)}
            <button class="secondary-command" data-action="post-match-lobby" type="button">Voltar ao lobby</button>
            <button class="ghost-command" data-action="post-match-menu" type="button">Voltar ao menu</button>
          </nav>
        </div>
    `;
  }

  private renderPostMatchBattle(): string {
    return `
      <section class="legacy-online-battle-screen post-match-battle-screen">
        ${this.renderLegacyBattleFrame()}
        ${this.renderPostMatchOverlay()}
      </section>
    `;
  }

  private renderPostMatch(): string {
    const match = this.state.match;
    const profile = this.state.snapshot.profile;
    if (!match || !profile) return "";
    const playerWon = match.winnerId === profile.id;
    const privateScore = match.privateScore;
    return `
      <section class="post-screen">
        <h1>${playerWon ? "Voce venceu" : match.winnerId ? "Voce perdeu" : "Empate"}</h1>
        ${match.matchType === "ranked" ? `<p>${match.rankDelta >= 0 ? "+" : ""}${match.rankDelta} pontos · streak atualizado</p>` : ""}
        ${privateScore ? `<p>Placar privado: ${privateScore.playerWins} x ${privateScore.opponentWins}</p>` : ""}
        <div class="button-row">
          ${this.renderRematchButton(match)}
          <button class="secondary-command" data-action="post-match-lobby" type="button">Voltar ao lobby</button>
          <button class="ghost-command" data-action="post-match-menu" type="button">Voltar ao menu</button>
        </div>
      </section>
    `;
  }

  private renderRanking(): string {
    const rank = this.state.snapshot.rank;
    const rankGroups = [
      { name: "Transcendentes", divisions: ["Primordial", "Arcanjo", "Desperto"] },
      { name: "Ouro", divisions: ["Ouro I", "Ouro II", "Ouro III"] },
      { name: "Prata", divisions: ["Prata I", "Prata II", "Prata III"] },
      { name: "Bronze", divisions: ["Bronze I", "Bronze II", "Bronze III"] },
      { name: "Altoprimata", divisions: ["Altoprimata I", "Altoprimata II", "Altoprimata III"] },
    ];

    return `
      <section class="screen-band ranking-screen">
        <div class="section-heading">
          <h1>Ranking</h1>
        </div>
        <nav class="ranking-tabs" aria-label="Visualizacao do ranking">
          <button class="ranking-tab ${this.rankingTab === "leaderboard" ? "active" : ""}" data-action="ranking-leaderboard" type="button" aria-pressed="${this.rankingTab === "leaderboard"}">Leaderboard</button>
          <button class="ranking-tab ${this.rankingTab === "progression" ? "active" : ""}" data-action="ranking-progression" type="button" aria-pressed="${this.rankingTab === "progression"}">Progressão</button>
        </nav>
        <div class="mobile-scroll-body ranking-scroll">
          ${this.rankingTab === "leaderboard" ? (this.state.leaderboard.length ? `
            <table class="ranking-table">
              <caption>Classificacao ranked</caption>
              <colgroup>
                <col class="ranking-player-col">
                <col class="ranking-points-col">
                <col class="ranking-record-col">
                <col class="ranking-streak-col">
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Jogador</th>
                  <th scope="col">Pts</th>
                  <th scope="col">V/D</th>
                  <th scope="col">Seq</th>
                </tr>
              </thead>
              <tbody>
                ${this.state.leaderboard.map((entry) => `
                  <tr class="${entry.userId === this.state.snapshot.profile?.id ? "current" : ""}">
                    <th scope="row">
                      <span class="ranking-player">
                        <span class="ranking-position">#${entry.position}</span>
                        <span class="ranking-name">${escapeHtml(entry.displayName)}</span>
                        <small>${entry.division}</small>
                      </span>
                    </th>
                    <td><strong>${entry.rankPoints}</strong><small>pts</small></td>
                    <td><strong>${entry.wins}/${entry.losses}</strong><small>V/D</small></td>
                    <td><strong>${entry.streak}</strong><small>seq</small></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          ` : `<p class="empty-state">Ranking vazio.</p>`) : `
            <div class="rank-ladder" aria-label="Progressao das divisoes">
              <div class="rank-ladder-intro">
                <span>Sua posição</span>
                <strong>${rank?.division ?? "Altoprimata III"}</strong>
                <b>${rank?.rankPoints ?? 0} pts</b>
              </div>
              ${rankGroups.map((group) => `
                <section class="rank-tier-group rank-tier-${group.name.toLowerCase().replaceAll(" ", "-")}" aria-label="${group.name}">
                  <div class="rank-tier-rows">
                    ${group.divisions.map((division) => {
                      const ruleIndex = RANK_RULES.findIndex((rule) => rule.division === division);
                      const rule = RANK_RULES[ruleIndex];
                      const nextRule = RANK_RULES[ruleIndex + 1];
                      const range = nextRule ? `${rule.minimumPoints}–${nextRule.minimumPoints - 1} pts` : `${rule.minimumPoints}+ pts`;
                      const current = rank?.division === division;
                      return `
                        <div class="rank-tier-row ${current ? "current" : ""}" ${current ? `aria-current="true"` : ""}>
                          <span class="rank-tier-name">${division}</span>
                          ${current ? `<strong class="rank-you-marker">Você</strong>` : ""}
                          <span class="rank-tier-details">
                            <small>${range}</small>
                            <span class="rank-tier-delta rank-tier-win">V +${rule.winPoints}</span>
                            <span class="rank-tier-delta rank-tier-loss">D −${rule.lossPoints}</span>
                          </span>
                        </div>
                      `;
                    }).join("")}
                  </div>
                </section>
              `).join("")}
            </div>
          `}
        </div>
        <nav class="mobile-bottom-actions" aria-label="Navegacao">
          <button class="danger-command simple-back-command" data-nav="menu" type="button">Voltar</button>
        </nav>
      </section>
    `;
  }

  private renderHistory(): string {
    return `
      <section class="screen-band">
        <div class="section-heading">
          <h1>Historico</h1>
          <button class="ghost-command" data-nav="menu" type="button">Voltar</button>
        </div>
        <div class="table-list">
          ${this.state.history.length ? this.state.history.map((entry) => `
            <div class="table-row">
              <strong>${entry.result === "win" ? "Vitoria" : entry.result === "loss" ? "Derrota" : "Empate"}</strong>
              <span>${entry.matchType}</span>
              <span>${escapeHtml(entry.opponentName)}</span>
              <span>${entry.rankDelta ? `${entry.rankDelta > 0 ? "+" : ""}${entry.rankDelta} pts` : "sem ranking"}</span>
              <span>${formatDate(entry.createdAt)}</span>
            </div>
          `).join("") : `<p class="empty-state">Nenhuma partida registrada.</p>`}
        </div>
      </section>
    `;
  }

}
