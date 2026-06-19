import { createInitialBattleState, resolveBattleTurn, selectableActions, turnDurationForState } from "../domain/battle";
import { applyRankedResult, createInitialRank } from "../domain/ranking";
import { characters, defaultCharacterIds } from "../data/characters";
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
} from "../types";
import type { GameService, QueueResult } from "./gameService";

const STORAGE_KEY = "finalGenesis.demoState";

interface DemoState {
  profile: PlayerProfile | null;
  rank: PlayerRank | null;
  unlockedCharacterIds: string[];
  history: MatchHistoryEntry[];
  currentMatch: GameMatch | null;
  privateRoom: PrivateRoom | null;
}

function makeGoogleLikeProfile(): PlayerProfile {
  return {
    id: `google-${crypto.randomUUID()}`,
    displayName: "Jogador Demo",
    avatarUrl: null,
    accountType: "google",
    selectedCharacterId: "ninja",
    presenceStatus: "online",
  };
}

function loadState(): DemoState {
  const fallback: DemoState = {
    profile: null,
    rank: null,
    unlockedCharacterIds: defaultCharacterIds(),
    history: [],
    currentMatch: null,
    privateRoom: null,
  };

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? { ...fallback, ...JSON.parse(stored) } : fallback;
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
    localAction: null,
    opponentHasAction: false,
    lastTurn: null,
    winnerId: null,
    rankDelta: 0,
    privateScore: type === "private" ? { playerWins: 0, opponentWins: 0 } : null,
    rematch: { localChoice: null, opponentChoice: null, nextMatchId: null },
  };
}

function createLeaderboard(currentRank: PlayerRank | null, profile: PlayerProfile | null): LeaderboardEntry[] {
  const base: LeaderboardEntry[] = [
    { position: 1, userId: "demo-1", displayName: "Astra", avatarUrl: null, rankPoints: 1640, division: "Diamond", wins: 91, losses: 34, streak: 8 },
    { position: 2, userId: "demo-2", displayName: "Khan", avatarUrl: null, rankPoints: 1225, division: "Platinum", wins: 61, losses: 25, streak: 3 },
    { position: 3, userId: "demo-3", displayName: "Iara", avatarUrl: null, rankPoints: 850, division: "Gold", wins: 47, losses: 31, streak: 5 },
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
    const profile = makeGoogleLikeProfile();
    const state = this.state();
    this.commit({
      ...state,
      profile,
      rank: createInitialRank(profile.id),
      unlockedCharacterIds: defaultCharacterIds(),
    });
  }

  async signOut(): Promise<void> {
    this.commit({ profile: null, rank: null, unlockedCharacterIds: defaultCharacterIds(), history: [], currentMatch: null, privateRoom: null });
  }

  async bootstrapProfile(): Promise<AppSnapshot> {
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

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const state = this.state();
    return createLeaderboard(state.rank, state.profile);
  }

  async getHistory(): Promise<MatchHistoryEntry[]> {
    return this.state().history;
  }

  async joinRankedQueue(): Promise<QueueResult> {
    const state = this.state();
    if (!state.profile) throw new Error("Entre no jogo antes de jogar ranked.");
    const match = makeMatch(state.profile, "ranked");
    this.commit({ ...state, currentMatch: match, profile: { ...state.profile, presenceStatus: "in_match" } });
    return { status: "matched", match };
  }

  async leaveRankedQueue(): Promise<void> {
    const state = this.state();
    if (state.profile) this.commit({ ...state, profile: { ...state.profile, presenceStatus: "online" } });
  }

  async getCurrentMatch(): Promise<GameMatch | null> {
    return this.state().currentMatch;
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
      inviteUrl: `${window.location.origin}/online/?room=${code}`,
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
      inviteUrl: `${window.location.origin}/online/?room=${code.toUpperCase()}`,
    };
    this.commit({ ...state, privateRoom: room, currentMatch: match, profile: { ...state.profile, presenceStatus: "in_match" } });
    return { room, match };
  }

  async getPrivateRoom(code: string): Promise<{ room: PrivateRoom; match: GameMatch | null }> {
    const state = this.state();
    if (!state.privateRoom || state.privateRoom.code !== code.toUpperCase()) throw new Error("Sala nao encontrada.");
    return { room: state.privateRoom, match: state.currentMatch };
  }

  async selectMatchCharacter(matchId: string, characterId: string): Promise<GameMatch> {
    const state = this.state();
    const match = state.currentMatch;
    if (!match || match.id !== matchId) throw new Error("Partida nao encontrada.");
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
    };
    this.commit({ ...state, currentMatch: nextMatch });
    return nextMatch;
  }

  async submitAction(matchId: string, action: Action): Promise<GameMatch> {
    const state = this.state();
    const match = state.currentMatch;
    if (!match || match.id !== matchId) throw new Error("Partida nao encontrada.");
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
      rematch: { localChoice: null, opponentChoice: null, nextMatchId: null },
    };

    const nextState = { ...state, currentMatch: nextMatch };
    if (result.finished && state.profile && state.rank) {
      const playerWon = nextMatch.winnerId === state.profile.id;
      if (match.matchType === "ranked") {
        const rank = applyRankedResult(state.rank, playerWon ? "win" : "loss");
        nextMatch = { ...nextMatch, rankDelta: playerWon ? 25 : -20 };
        nextState.rank = rank;
        nextState.currentMatch = nextMatch;
      } else {
        nextMatch = {
          ...nextMatch,
          privateScore: {
            playerWins: playerWon ? 1 : 0,
            opponentWins: playerWon ? 0 : 1,
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
    if (!state.currentMatch || state.currentMatch.id !== matchId) throw new Error("Partida nao encontrada.");
    return state.currentMatch;
  }

  async forfeitMatch(matchId: string): Promise<GameMatch> {
    const state = this.state();
    const match = state.currentMatch;
    if (!match || match.id !== matchId || !state.profile) throw new Error("Partida nao encontrada.");
    const nextMatch = { ...match, status: "forfeited" as const, winnerId: match.p2.userId };
    const history: MatchHistoryEntry = {
      id: crypto.randomUUID(),
      matchId,
      opponentName: match.p2.displayName,
      matchType: match.matchType,
      characterId: match.p1.characterId || "ninja",
      opponentCharacterId: match.p2.characterId || "ninja",
      result: "loss",
      rankDelta: match.matchType === "ranked" ? -25 : 0,
      createdAt: new Date().toISOString(),
    };
    this.commit({ ...state, currentMatch: nextMatch, history: [history, ...state.history], profile: { ...state.profile, presenceStatus: "online" } });
    return nextMatch;
  }

  async postMatchChoice(matchId: string, choice: RematchChoice): Promise<GameMatch> {
    const state = this.state();
    const match = state.currentMatch;
    if (!match || match.id !== matchId) throw new Error("Partida nao encontrada.");
    if (choice === "lobby") {
      const nextMatch = { ...match, rematch: { ...match.rematch, localChoice: "lobby" as const } };
      this.commit({ ...state, currentMatch: nextMatch });
      return nextMatch;
    }

    const nextMatch = {
      ...makeMatch(state.profile!, match.matchType === "private" ? "private" : "ranked"),
      p1: { ...match.p1 },
      p2: { ...match.p2 },
      battleState: createInitialBattleState(),
      status: "active" as const,
      rematch: { localChoice: "again" as const, opponentChoice: "again" as const, nextMatchId: null },
    };
    this.commit({ ...state, currentMatch: nextMatch });
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
