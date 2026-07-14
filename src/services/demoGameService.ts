import { createInitialBattleState, resolveBattleTurn, selectableActions, turnDurationForState } from "../domain/battle";
import { applyRankedResult, createInitialRank, divisionForPoints, rankedDeltaForResult } from "../domain/ranking";
import { characters, defaultCharacterIds } from "../data/characters";
import { privateRoomInviteUrl } from "../lib/config";
import type {
  Action,
  AppSnapshot,
  GameMatch,
  LeaderboardEntry,
  MatchHistoryEntry,
  MatchPlayer,
  PlayerProfile,
  PlayerRank,
  PrivateRoom,
  RematchChoice,
  ReplaySource,
  TurnResolution,
} from "../types";
import type { GameService, QueueResult } from "./gameService";

const STORAGE_KEY = "finalGenesis.demoState";
const REPLAY_SOURCE_LIMIT = 25;

interface DemoState {
  accountId: string | null;
  profile: PlayerProfile | null;
  rank: PlayerRank | null;
  unlockedCharacterIds: string[];
  history: MatchHistoryEntry[];
  currentMatch: GameMatch | null;
  privateRoom: PrivateRoom | null;
  replayMatches: Record<string, DemoReplayMatch>;
}

interface DemoReplayMatch {
  matchId: string;
  matchType: ReplaySource["matchType"];
  player1Id: string;
  player2Id: string;
  player1CharacterId: string | null;
  player2CharacterId: string | null;
  winnerId: string | null;
  finishedReason: string | null;
  createdAt: string;
  finishedAt: string | null;
  turns: ReplaySource["turns"];
}

function makeGoogleLikeProfile(accountId = `google-${crypto.randomUUID()}`): PlayerProfile {
  return {
    id: accountId,
    displayName: "Jogador Demo",
    displayNameUpdatedAt: null,
    avatarUrl: null,
    accountType: "google",
    selectedCharacterId: "ninja",
    presenceStatus: "online",
  };
}

function loadState(): DemoState {
  const fallback: DemoState = {
    accountId: null,
    profile: null,
    rank: null,
    unlockedCharacterIds: defaultCharacterIds(),
    history: [],
    currentMatch: null,
    privateRoom: null,
    replayMatches: {},
  };

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;
    const loaded = { ...fallback, ...JSON.parse(stored) } as DemoState;
    if (!loaded.replayMatches || typeof loaded.replayMatches !== "object" || Array.isArray(loaded.replayMatches)) {
      loaded.replayMatches = {};
    }
    loaded.accountId = loaded.accountId
      || loaded.profile?.id
      || Object.values(loaded.replayMatches)[0]?.player1Id
      || null;
    if (loaded.rank) loaded.rank.division = divisionForPoints(loaded.rank.rankPoints);
    return loaded;
  } catch {
    return fallback;
  }
}

function saveState(state: DemoState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function randomOpponent(): MatchPlayer {
  return {
    userId: `opponent-${crypto.randomUUID()}`,
    displayName: ["Kael", "Maya", "Ryu", "Sombra"][Math.floor(Math.random() * 4)],
    avatarUrl: null,
    characterId: null,
  };
}

function makeMatch(profile: PlayerProfile, type: "ranked" | "private"): GameMatch {
  const opponent = randomOpponent();
  const p1: MatchPlayer = {
    userId: profile.id,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    characterId: null,
  };
  const battleState = createInitialBattleState();

  return {
    id: crypto.randomUUID(),
    matchType: type,
    status: "selecting",
    playerSide: "p1",
    p1,
    p2: opponent,
    battleState,
    currentTurn: battleState.turnNumber,
    turnDeadlineAt: new Date(Date.now() + turnDurationForState(battleState)).toISOString(),
    serverNow: new Date().toISOString(),
    localReady: false,
    opponentReady: false,
    loadingDeadlineAt: null,
    battleStartAt: null,
    localAction: null,
    opponentHasAction: false,
    lastTurn: null,
    winnerId: null,
    rankDelta: 0,
    privateScore: type === "private" ? { playerWins: 0, opponentWins: 0 } : null,
    rematch: { localChoice: null, opponentChoice: null, nextMatchId: null },
  };
}

function makeReplayMatch(match: GameMatch, createdAt = new Date().toISOString()): DemoReplayMatch {
  if (match.matchType !== "ranked" && match.matchType !== "private") {
    throw new Error("Somente partidas ranqueadas ou privadas podem gerar replay.");
  }
  return {
    matchId: match.id,
    matchType: match.matchType,
    player1Id: match.p1.userId,
    player2Id: match.p2.userId,
    player1CharacterId: match.p1.characterId,
    player2CharacterId: match.p2.characterId,
    winnerId: match.winnerId,
    finishedReason: match.finishedReason || null,
    createdAt,
    finishedAt: null,
    turns: [],
  };
}

function updateReplayMatch(
  replayMatches: DemoState["replayMatches"],
  match: GameMatch,
  options: { turn?: TurnResolution; finishedAt?: string | null } = {},
): DemoState["replayMatches"] {
  if (match.matchType !== "ranked" && match.matchType !== "private") return replayMatches;
  const previous = replayMatches[match.id] || makeReplayMatch(match);
  let turns = previous.turns;
  if (options.turn) {
    const turnNumber = options.turn.before.turnNumber;
    const nextTurn = { turnNumber, result: options.turn };
    const existingIndex = turns.findIndex((turn) => turn.turnNumber === turnNumber);
    turns = existingIndex >= 0
      ? turns.map((turn, index) => index === existingIndex ? nextTurn : turn)
      : [...turns, nextTurn].sort((left, right) => left.turnNumber - right.turnNumber);
  }

  const updated = {
    ...replayMatches,
    [match.id]: {
      ...previous,
      matchType: match.matchType,
      player1Id: match.p1.userId,
      player2Id: match.p2.userId,
      player1CharacterId: match.p1.characterId,
      player2CharacterId: match.p2.characterId,
      winnerId: match.winnerId,
      finishedReason: match.finishedReason || null,
      finishedAt: options.finishedAt === undefined ? previous.finishedAt : options.finishedAt,
      turns,
    },
  };
  const current = updated[match.id];
  const previousSources = Object.values(updated)
    .filter((replay) => replay.matchId !== match.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, REPLAY_SOURCE_LIMIT - 1);
  return Object.fromEntries(
    [current, ...previousSources].map((replay) => [replay.matchId, replay]),
  );
}

function createLeaderboard(currentRank: PlayerRank | null, profile: PlayerProfile | null): LeaderboardEntry[] {
  const base: LeaderboardEntry[] = [
    { position: 1, userId: "demo-1", displayName: "Astra", avatarUrl: null, rankPoints: 3160, division: "Primordial", wins: 91, losses: 34, streak: 8 },
    { position: 2, userId: "demo-2", displayName: "Khan", avatarUrl: null, rankPoints: 2700, division: "Arcanjo", wins: 61, losses: 25, streak: 3 },
    { position: 3, userId: "demo-3", displayName: "Iara", avatarUrl: null, rankPoints: 2300, division: "Desperto", wins: 47, losses: 31, streak: 5 },
  ];

  if (currentRank && profile) {
    base.push({
      position: base.length + 1,
      userId: profile.id,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      rankPoints: currentRank.rankPoints,
      division: currentRank.division,
      wins: currentRank.wins,
      losses: currentRank.losses,
      streak: currentRank.streak,
    });
  }

  return base.sort((a, b) => b.rankPoints - a.rankPoints).map((entry, index) => ({ ...entry, position: index + 1 }));
}

export class DemoGameService implements GameService {
  readonly mode = "demo" as const;
  private listeners = new Set<() => void>();

  private state(): DemoState {
    return loadState();
  }

  private commit(state: DemoState): void {
    saveState(state);
    this.listeners.forEach((listener) => listener());
  }

  async getSnapshot(): Promise<AppSnapshot> {
    const state = this.state();
    return { profile: state.profile, rank: state.rank, unlockedCharacterIds: state.unlockedCharacterIds };
  }

  async signInWithGoogle(): Promise<void> {
    const state = this.state();
    const profile = makeGoogleLikeProfile(state.accountId || undefined);
    this.commit({
      ...state,
      accountId: profile.id,
      profile,
      rank: createInitialRank(profile.id),
      unlockedCharacterIds: defaultCharacterIds(),
    });
  }

  async signOut(): Promise<void> {
    const state = this.state();
    this.commit({
      accountId: state.accountId,
      profile: null,
      rank: null,
      unlockedCharacterIds: defaultCharacterIds(),
      history: [],
      currentMatch: null,
      privateRoom: null,
      replayMatches: state.replayMatches,
    });
  }

  async bootstrapProfile(): Promise<AppSnapshot> {
    return this.getSnapshot();
  }

  async updateDisplayName(displayName: string): Promise<AppSnapshot> {
    const state = this.state();
    if (!state.profile) throw new Error("Entre no jogo antes de editar o perfil.");
    const previousChange = state.profile.displayNameUpdatedAt ? new Date(state.profile.displayNameUpdatedAt).getTime() : 0;
    if (previousChange && Date.now() - previousChange < 24 * 60 * 60 * 1000) {
      throw new Error("O nome só pode ser alterado uma vez a cada 24 horas.");
    }
    this.commit({
      ...state,
      profile: { ...state.profile, displayName, displayNameUpdatedAt: new Date().toISOString() },
    });
    return this.getSnapshot();
  }

  async selectCharacter(characterId: string): Promise<AppSnapshot> {
    const state = this.state();
    if (!state.profile) throw new Error("Entre no jogo antes de selecionar personagem.");
    if (!state.unlockedCharacterIds.includes(characterId)) throw new Error("Personagem bloqueado.");
    const next = { ...state, profile: { ...state.profile, selectedCharacterId: characterId } };
    this.commit(next);
    return this.getSnapshot();
  }

  async heartbeat(status: PlayerProfile["presenceStatus"]): Promise<void> {
    const state = this.state();
    if (!state.profile) return;
    this.commit({ ...state, profile: { ...state.profile, presenceStatus: status } });
  }

  async cancelMatchSelection(matchId: string): Promise<void> {
    const state = this.state();
    if (!state.currentMatch || state.currentMatch.id !== matchId) return;
    const nextMatch: GameMatch = {
      ...state.currentMatch,
      status: "forfeited",
      winnerId: null,
      finishedReason: "selection_cancelled",
    };
    this.commit({
      ...state,
      currentMatch: nextMatch,
      privateRoom: null,
      profile: state.profile ? { ...state.profile, presenceStatus: "online" } : null,
      replayMatches: updateReplayMatch(state.replayMatches, nextMatch, { finishedAt: new Date().toISOString() }),
    });
  }

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const state = this.state();
    return createLeaderboard(state.rank, state.profile);
  }

  async getLeaderboardEntry(userId: string): Promise<LeaderboardEntry | null> {
    const knownEntry = (await this.getLeaderboard()).find((entry) => entry.userId === userId);
    if (knownEntry) return knownEntry;
    return {
      position: 4,
      userId,
      displayName: this.state().currentMatch?.p2.displayName || "Adversário",
      avatarUrl: null,
      rankPoints: 460,
      division: "Bronze II",
      wins: 12,
      losses: 8,
      streak: 2,
    };
  }

  async getHistory(): Promise<MatchHistoryEntry[]> {
    return this.state().history;
  }

  async getCharacterUsage(): Promise<Record<string, number>> {
    return this.state().history.reduce<Record<string, number>>((usage, entry) => {
      usage[entry.characterId] = (usage[entry.characterId] || 0) + 1;
      return usage;
    }, {});
  }

  async joinRankedQueue(): Promise<QueueResult> {
    const state = this.state();
    if (!state.profile) throw new Error("Entre no jogo antes de jogar ranked.");
    const match = makeMatch(state.profile, "ranked");
    this.commit({
      ...state,
      currentMatch: match,
      profile: { ...state.profile, presenceStatus: "in_match" },
      replayMatches: updateReplayMatch(state.replayMatches, match),
    });
    return { status: "matched", match };
  }

  async leaveRankedQueue(): Promise<void> {
    const state = this.state();
    if (state.profile) this.commit({ ...state, profile: { ...state.profile, presenceStatus: "online" } });
  }

  async getCurrentMatch(): Promise<GameMatch | null> {
    return this.state().currentMatch;
  }

  async getMatch(matchId: string): Promise<GameMatch | null> {
    const match = this.state().currentMatch;
    return match?.id === matchId ? match : null;
  }

  async getReplaySource(matchId: string): Promise<ReplaySource> {
    if (!matchId.trim()) throw new Error("Identificador da partida ausente para o replay.");
    const replay = this.state().replayMatches[matchId];
    if (!replay) throw new Error("Partida não encontrada para o replay demo.");
    if (replay.matchType !== "ranked" && replay.matchType !== "private") {
      throw new Error("Somente partidas ranqueadas ou privadas podem gerar replay.");
    }
    if (replay.turns.length > 0 && (!replay.player1CharacterId || !replay.player2CharacterId)) {
      throw new Error("O replay não está disponível porque a seleção de personagens não foi concluída.");
    }

    return {
      matchId: replay.matchId,
      matchType: replay.matchType,
      player1Id: replay.player1Id,
      player2Id: replay.player2Id,
      player1CharacterId: replay.player1CharacterId,
      player2CharacterId: replay.player2CharacterId,
      winnerId: replay.winnerId || null,
      finishedReason: replay.finishedReason || null,
      createdAt: replay.createdAt,
      finishedAt: replay.finishedAt || null,
      turns: [...(replay.turns || [])].sort((left, right) => left.turnNumber - right.turnNumber),
    };
  }

  async getMatchedQueueMatch(): Promise<GameMatch | null> {
    return this.state().currentMatch;
  }

  async createPrivateRoom(): Promise<PrivateRoom> {
    const state = this.state();
    if (!state.profile) throw new Error("Entre no jogo antes de criar sala.");
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const room: PrivateRoom = {
      code,
      status: "waiting",
      hostName: state.profile.displayName,
      guestName: null,
      matchId: null,
      inviteUrl: privateRoomInviteUrl(code),
    };
    this.commit({ ...state, privateRoom: room });
    return room;
  }

  async joinPrivateRoom(code: string): Promise<{ room: PrivateRoom; match: GameMatch | null }> {
    const state = this.state();
    if (!state.profile) throw new Error("Entre no jogo antes de entrar na sala.");
    const match = makeMatch(state.profile, "private");
    const room: PrivateRoom = {
      code: code.toUpperCase(),
      status: "active",
      hostName: "Host Demo",
      guestName: state.profile.displayName,
      matchId: match.id,
      inviteUrl: privateRoomInviteUrl(code),
    };
    this.commit({
      ...state,
      privateRoom: room,
      currentMatch: match,
      profile: { ...state.profile, presenceStatus: "in_match" },
      replayMatches: updateReplayMatch(state.replayMatches, match),
    });
    return { room, match };
  }

  async getPrivateRoom(code: string): Promise<{ room: PrivateRoom; match: GameMatch | null }> {
    const state = this.state();
    if (!state.privateRoom || state.privateRoom.code !== code.toUpperCase()) throw new Error("Sala não encontrada.");
    return { room: state.privateRoom, match: state.currentMatch };
  }

  async selectMatchCharacter(matchId: string, characterId: string): Promise<GameMatch> {
    const state = this.state();
    const match = state.currentMatch;
    if (!match || match.id !== matchId) throw new Error("Partida não encontrada.");
    if (!state.unlockedCharacterIds.includes(characterId)) throw new Error("Personagem bloqueado.");

    const enabledCharacters = characters.filter((character) => character.enabled);
    const opponentCharacter = enabledCharacters[Math.floor(Math.random() * enabledCharacters.length)];
    const nextMatch: GameMatch = {
      ...match,
      status: "active",
      p1: { ...match.p1, characterId },
      p2: { ...match.p2, characterId: opponentCharacter.id },
      turnDeadlineAt: new Date(Date.now() + turnDurationForState(match.battleState)).toISOString(),
      serverNow: new Date().toISOString(),
      localReady: true,
      opponentReady: true,
    };
    this.commit({
      ...state,
      currentMatch: nextMatch,
      replayMatches: updateReplayMatch(state.replayMatches, nextMatch),
    });
    return nextMatch;
  }

  async markMatchReady(matchId: string): Promise<GameMatch> {
    const match = this.state().currentMatch;
    if (!match || match.id !== matchId) throw new Error("Partida não encontrada.");
    return match;
  }

  async markTurnReady(matchId: string, _turnNumber: number): Promise<void> {
    const match = this.state().currentMatch;
    if (!match || match.id !== matchId) throw new Error("Partida não encontrada.");
  }

  async submitAction(matchId: string, action: Action, _turnNumber?: number): Promise<GameMatch> {
    const state = this.state();
    const match = state.currentMatch;
    if (!match || match.id !== matchId) throw new Error("Partida não encontrada.");
    if (match.status !== "active") return match;

    const opponentAction = selectableActions[Math.floor(Math.random() * selectableActions.length)];
    const result = resolveBattleTurn(match.battleState, action, opponentAction, {
      p1CharacterId: match.p1.characterId,
      p2CharacterId: match.p2.characterId,
    });
    let nextMatch: GameMatch = {
      ...match,
      battleState: result.after,
      currentTurn: result.after.turnNumber,
      turnDeadlineAt: new Date(Date.now() + turnDurationForState(result.after)).toISOString(),
      serverNow: new Date().toISOString(),
      localAction: null,
      opponentHasAction: false,
      lastTurn: result,
      status: result.finished ? "finished" : "active",
      winnerId: result.matchWinner ? match[result.matchWinner].userId : null,
      finishedReason: result.finished ? "finished" : match.finishedReason,
      rematch: { localChoice: null, opponentChoice: null, nextMatchId: null },
    };

    const nextState: DemoState = {
      ...state,
      currentMatch: nextMatch,
      replayMatches: updateReplayMatch(state.replayMatches, nextMatch, {
        turn: result,
        finishedAt: result.finished ? new Date().toISOString() : undefined,
      }),
    };
    if (result.finished && state.profile && state.rank) {
      const playerWon = nextMatch.winnerId === state.profile.id;
      if (match.matchType === "ranked") {
        const rankedResult = playerWon ? "win" : "loss";
        const rankDelta = rankedDeltaForResult(state.rank.rankPoints, rankedResult);
        const rank = applyRankedResult(state.rank, rankedResult);
        nextMatch = { ...nextMatch, rankDelta };
        nextState.rank = rank;
        nextState.currentMatch = nextMatch;
      } else {
        const currentScore = match.privateScore || { playerWins: 0, opponentWins: 0 };
        nextMatch = {
          ...nextMatch,
          privateScore: {
            playerWins: currentScore.playerWins + (playerWon ? 1 : 0),
            opponentWins: currentScore.opponentWins + (playerWon ? 0 : 1),
          },
        };
        nextState.currentMatch = nextMatch;
      }
      nextState.history = [
        {
          id: crypto.randomUUID(),
          matchId: match.id,
          opponentName: match.p2.displayName,
          matchType: match.matchType,
          characterId: match.p1.characterId || "ninja",
          opponentCharacterId: match.p2.characterId || "ninja",
          result: playerWon ? "win" : "loss",
          rankDelta: nextMatch.rankDelta,
          createdAt: new Date().toISOString(),
        },
        ...state.history,
      ];
      nextState.profile = { ...state.profile, presenceStatus: "online" };
    }

    this.commit(nextState);
    return nextState.currentMatch!;
  }

  async resolveTurn(matchId: string): Promise<GameMatch> {
    const state = this.state();
    if (!state.currentMatch || state.currentMatch.id !== matchId) throw new Error("Partida não encontrada.");
    return state.currentMatch;
  }

  async forfeitMatch(matchId: string): Promise<GameMatch> {
    const state = this.state();
    const match = state.currentMatch;
    if (!match || match.id !== matchId || !state.profile) throw new Error("Partida não encontrada.");
    const rankDelta = match.matchType === "ranked" && state.rank
      ? rankedDeltaForResult(state.rank.rankPoints, "forfeit")
      : 0;
    const nextMatch = {
      ...match,
      status: "forfeited" as const,
      winnerId: match.p2.userId,
      rankDelta,
      finishedReason: "forfeit",
    };
    const history: MatchHistoryEntry = {
      id: crypto.randomUUID(),
      matchId,
      opponentName: match.p2.displayName,
      matchType: match.matchType,
      characterId: match.p1.characterId || "ninja",
      opponentCharacterId: match.p2.characterId || "ninja",
      result: "loss",
      rankDelta,
      createdAt: new Date().toISOString(),
    };
    const rank = match.matchType === "ranked" && state.rank
      ? applyRankedResult(state.rank, "forfeit")
      : state.rank;
    this.commit({
      ...state,
      rank,
      currentMatch: nextMatch,
      history: [history, ...state.history],
      profile: { ...state.profile, presenceStatus: "online" },
      replayMatches: updateReplayMatch(state.replayMatches, nextMatch, { finishedAt: new Date().toISOString() }),
    });
    return nextMatch;
  }

  async postMatchChoice(matchId: string, choice: RematchChoice): Promise<GameMatch> {
    const state = this.state();
    const match = state.currentMatch;
    if (!match || match.id !== matchId) throw new Error("Partida não encontrada.");
    if (choice === "lobby") {
      const nextMatch = {
        ...match,
        privateScore: match.matchType === "private" ? { playerWins: 0, opponentWins: 0 } : match.privateScore,
        rematch: { ...match.rematch, localChoice: "lobby" as const },
      };
      this.commit({ ...state, currentMatch: nextMatch });
      return nextMatch;
    }

    const nextMatch = {
      ...makeMatch(state.profile!, match.matchType === "private" ? "private" : "ranked"),
      p1: { ...match.p1 },
      p2: { ...match.p2 },
      battleState: createInitialBattleState(),
      status: "active" as const,
      privateScore: match.matchType === "private" ? match.privateScore : null,
      rematch: { localChoice: "again" as const, opponentChoice: "again" as const, nextMatchId: null },
    };
    this.commit({
      ...state,
      currentMatch: nextMatch,
      replayMatches: updateReplayMatch(state.replayMatches, nextMatch),
    });
    return nextMatch;
  }

  watchMatch(_matchId: string, onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  watchRankedQueue(_userId: string, onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  watchPrivateRoom(_code: string, onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }
}
