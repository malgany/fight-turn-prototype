import type { LocalReplay, MatchResult, ReplayPlayerSnapshot, ReplaySource, ReplayTurnRecord } from "../types";

export const REPLAY_DB_NAME = "finalGenesis.replays";
export const REPLAY_DB_VERSION = 1;
export const REPLAY_STORE_NAME = "replays";
export const RECENT_REPLAY_LIMIT = 20;

type ReplayKey = [ownerId: string, matchId: string];

export class ReplayStoreUnavailableError extends Error {
  constructor() {
    super("O armazenamento local de replays não está disponível neste dispositivo.");
    this.name = "ReplayStoreUnavailableError";
  }
}

export class ReplaySourceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplaySourceValidationError";
  }
}

function replayTimestamp(replay: LocalReplay): number {
  const value = replay.finishedAt || replay.createdAt;
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function compareReplaysNewestFirst(left: LocalReplay, right: LocalReplay): number {
  const timestampDifference = replayTimestamp(right) - replayTimestamp(left);
  if (timestampDifference !== 0) return timestampDifference;
  return right.matchId.localeCompare(left.matchId);
}

/**
 * Combines turn collections without ever duplicating a turn number. Records from
 * `incoming` win, which lets an authoritative source replace an observed record.
 */
export function mergeReplayTurns(
  existing: readonly ReplayTurnRecord[],
  incoming: readonly ReplayTurnRecord[],
): ReplayTurnRecord[] {
  const turnsByNumber = new Map<number, ReplayTurnRecord>();

  for (const turn of [...existing, ...incoming]) {
    if (!Number.isInteger(turn.turnNumber) || turn.turnNumber < 1) {
      throw new ReplaySourceValidationError(`Número de turno inválido: ${turn.turnNumber}.`);
    }
    turnsByNumber.set(turn.turnNumber, turn);
  }

  return [...turnsByNumber.values()].sort((left, right) => left.turnNumber - right.turnNumber);
}

export function selectRecentReplays(
  replays: readonly LocalReplay[],
  limit = RECENT_REPLAY_LIMIT,
): LocalReplay[] {
  return replays
    .filter((replay) => replay.status === "complete")
    .sort(compareReplaysNewestFirst)
    .slice(0, Math.max(0, limit));
}

export function selectFavoriteReplays(replays: readonly LocalReplay[]): LocalReplay[] {
  return replays
    .filter((replay) => replay.status === "complete" && replay.favorite)
    .sort(compareReplaysNewestFirst);
}

export function selectPendingReplays(replays: readonly LocalReplay[]): LocalReplay[] {
  return replays.filter((replay) => replay.status === "pending").sort(compareReplaysNewestFirst);
}

export function selectCleanupMatchIds(
  replays: readonly LocalReplay[],
  limit = RECENT_REPLAY_LIMIT,
): string[] {
  const retainedRecentIds = new Set(selectRecentReplays(replays, limit).map((replay) => replay.matchId));
  return replays
    .filter(
      (replay) => replay.status === "complete" && !replay.favorite && !retainedRecentIds.has(replay.matchId),
    )
    .map((replay) => replay.matchId);
}

function mergeReplaySnapshot(
  existing: ReplayPlayerSnapshot | undefined,
  incoming: ReplayPlayerSnapshot,
): ReplayPlayerSnapshot {
  return {
    ...existing,
    ...incoming,
    displayName: incoming.displayName || existing?.displayName || "Jogador",
    characterId: incoming.characterId || existing?.characterId || "",
    rankPoints: incoming.rankPoints ?? existing?.rankPoints ?? null,
    division: incoming.division ?? existing?.division ?? null,
  };
}

export function mergeReplayDraft(existing: LocalReplay | null, draft: LocalReplay): LocalReplay {
  if (existing && (existing.ownerId !== draft.ownerId || existing.matchId !== draft.matchId)) {
    throw new ReplaySourceValidationError("O rascunho não pertence à partida armazenada.");
  }

  if (existing?.status === "complete") return existing;

  return {
    ...existing,
    ...draft,
    schemaVersion: 1,
    favorite: existing?.favorite ?? draft.favorite,
    status: "pending",
    p1: mergeReplaySnapshot(existing?.p1, draft.p1),
    p2: mergeReplaySnapshot(existing?.p2, draft.p2),
    turns: mergeReplayTurns(existing?.turns || [], draft.turns),
  };
}

function snapshotForSourcePlayer(
  draft: LocalReplay,
  userId: string,
  characterId: string,
  fallback: ReplayPlayerSnapshot,
): ReplayPlayerSnapshot {
  const matchingSnapshot = [draft.p1, draft.p2].find((snapshot) => snapshot.userId === userId) || fallback;
  return {
    ...matchingSnapshot,
    userId,
    characterId,
  };
}

function resultForOwner(ownerId: string, winnerId: string | null): MatchResult {
  if (!winnerId) return "draw";
  return winnerId === ownerId ? "win" : "loss";
}

/** Creates a complete replay using only authoritative turns from the source. */
export function finalizeReplayDraft(draft: LocalReplay, source: ReplaySource): LocalReplay {
  if (draft.matchId !== source.matchId) {
    throw new ReplaySourceValidationError("A fonte pertence a outra partida.");
  }
  if (![source.player1Id, source.player2Id].includes(draft.ownerId)) {
    throw new ReplaySourceValidationError("A conta proprietária não participou desta partida.");
  }
  if (source.winnerId && ![source.player1Id, source.player2Id].includes(source.winnerId)) {
    throw new ReplaySourceValidationError("O vencedor informado não participou desta partida.");
  }
  if (!source.finishedAt) {
    throw new ReplaySourceValidationError("A partida ainda não possui horário de término.");
  }

  const authoritativeTurns = mergeReplayTurns([], source.turns);
  if (authoritativeTurns.length === 0) {
    throw new ReplaySourceValidationError("Uma partida sem turnos autoritativos não pode gerar replay.");
  }
  if (!source.player1CharacterId || !source.player2CharacterId) {
    throw new ReplaySourceValidationError("Uma partida com turnos precisa informar os dois personagens.");
  }

  const authoritativeTurnNumbers = new Set(authoritativeTurns.map((turn) => turn.turnNumber));
  const missingObservedTurn = draft.turns.find((turn) => !authoritativeTurnNumbers.has(turn.turnNumber));
  if (missingObservedTurn) {
    throw new ReplaySourceValidationError(
      `O turno observado ${missingObservedTurn.turnNumber} ainda não existe na fonte autoritativa.`,
    );
  }

  const playerSide = draft.ownerId === source.player1Id ? "p1" : "p2";

  return {
    ...draft,
    schemaVersion: 1,
    matchType: source.matchType,
    playerSide,
    p1: snapshotForSourcePlayer(draft, source.player1Id, source.player1CharacterId, draft.p1),
    p2: snapshotForSourcePlayer(draft, source.player2Id, source.player2CharacterId, draft.p2),
    winnerId: source.winnerId,
    result: resultForOwner(draft.ownerId, source.winnerId),
    finishedReason: source.finishedReason,
    createdAt: source.createdAt,
    finishedAt: source.finishedAt,
    favorite: draft.favorite,
    status: "complete",
    turns: authoritativeTurns,
  };
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha em uma operação do IndexedDB."));
  });
}

function transactionAsPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Operação do IndexedDB cancelada."));
    transaction.onerror = () => reject(transaction.error || new Error("Falha em uma transação do IndexedDB."));
  });
}

function defaultIndexedDbFactory(): IDBFactory | null {
  return typeof globalThis.indexedDB === "undefined" ? null : globalThis.indexedDB;
}

export class ReplayStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly indexedDbFactory: IDBFactory | null = defaultIndexedDbFactory()) {}

  async get(ownerId: string, matchId: string): Promise<LocalReplay | null> {
    return this.withStore("readonly", async (store) => {
      const replay = await requestAsPromise(store.get(this.key(ownerId, matchId)));
      return (replay as LocalReplay | undefined) || null;
    });
  }

  async upsertDraft(draft: LocalReplay): Promise<LocalReplay> {
    return this.withStore("readwrite", async (store) => {
      const stored = (await requestAsPromise(store.get(this.key(draft.ownerId, draft.matchId)))) as
        | LocalReplay
        | undefined;
      const replay = mergeReplayDraft(stored || null, draft);
      await requestAsPromise(store.put(replay));
      return replay;
    });
  }

  async recordObservedTurn(
    ownerId: string,
    matchId: string,
    turn: ReplayTurnRecord,
  ): Promise<LocalReplay | null> {
    return this.withStore("readwrite", async (store) => {
      const stored = (await requestAsPromise(store.get(this.key(ownerId, matchId)))) as LocalReplay | undefined;
      if (!stored || stored.status === "complete") return stored || null;

      const replay: LocalReplay = {
        ...stored,
        turns: mergeReplayTurns(stored.turns, [turn]),
      };
      await requestAsPromise(store.put(replay));
      return replay;
    });
  }

  async finalize(ownerId: string, matchId: string, source: ReplaySource): Promise<LocalReplay | null> {
    return this.withStore("readwrite", async (store) => {
      const stored = (await requestAsPromise(store.get(this.key(ownerId, matchId)))) as LocalReplay | undefined;
      if (!stored) return null;

      const replay = finalizeReplayDraft(stored, source);
      await requestAsPromise(store.put(replay));

      const ownerReplays = await this.getAllForOwner(store, ownerId);
      const cleanupIds = selectCleanupMatchIds(ownerReplays);
      await Promise.all(cleanupIds.map((cleanupMatchId) => requestAsPromise(store.delete(this.key(ownerId, cleanupMatchId)))));
      return replay;
    });
  }

  async listRecent(ownerId: string): Promise<LocalReplay[]> {
    return this.withStore("readonly", async (store) => selectRecentReplays(await this.getAllForOwner(store, ownerId)));
  }

  async listFavorites(ownerId: string): Promise<LocalReplay[]> {
    return this.withStore("readonly", async (store) => selectFavoriteReplays(await this.getAllForOwner(store, ownerId)));
  }

  async listPending(ownerId: string): Promise<LocalReplay[]> {
    return this.withStore("readonly", async (store) => selectPendingReplays(await this.getAllForOwner(store, ownerId)));
  }

  async toggleFavorite(ownerId: string, matchId: string): Promise<LocalReplay | null> {
    return this.withStore("readwrite", async (store) => {
      const ownerReplays = await this.getAllForOwner(store, ownerId);
      const stored = ownerReplays.find((replay) => replay.matchId === matchId);
      if (!stored) return null;

      const replay: LocalReplay = { ...stored, favorite: !stored.favorite };
      const recentIds = new Set(selectRecentReplays(ownerReplays).map((recent) => recent.matchId));
      if (!replay.favorite && replay.status === "complete" && !recentIds.has(replay.matchId)) {
        await requestAsPromise(store.delete(this.key(ownerId, matchId)));
        return null;
      }

      await requestAsPromise(store.put(replay));
      return replay;
    });
  }

  async cleanup(ownerId: string): Promise<number> {
    return this.withStore("readwrite", async (store) => {
      const ownerReplays = await this.getAllForOwner(store, ownerId);
      const cleanupIds = selectCleanupMatchIds(ownerReplays);
      await Promise.all(cleanupIds.map((matchId) => requestAsPromise(store.delete(this.key(ownerId, matchId)))));
      return cleanupIds.length;
    });
  }

  async discard(ownerId: string, matchId: string): Promise<void> {
    await this.withStore("readwrite", async (store) => {
      await requestAsPromise(store.delete(this.key(ownerId, matchId)));
    });
  }

  close(): void {
    if (!this.databasePromise) return;
    void this.databasePromise.then((database) => database.close()).catch(() => undefined);
    this.databasePromise = null;
  }

  private key(ownerId: string, matchId: string): ReplayKey {
    return [ownerId, matchId];
  }

  private async getAllForOwner(store: IDBObjectStore, ownerId: string): Promise<LocalReplay[]> {
    const allReplays = (await requestAsPromise(store.getAll())) as LocalReplay[];
    return allReplays.filter((replay) => replay.ownerId === ownerId);
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const database = await this.openDatabase();
    const transaction = database.transaction(REPLAY_STORE_NAME, mode);
    const completion = transactionAsPromise(transaction);

    try {
      const result = await operation(transaction.objectStore(REPLAY_STORE_NAME));
      await completion;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already have failed or completed.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (!this.indexedDbFactory) return Promise.reject(new ReplayStoreUnavailableError());
    if (this.databasePromise) return this.databasePromise;

    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.indexedDbFactory!.open(REPLAY_DB_NAME, REPLAY_DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.objectStoreNames.contains(REPLAY_STORE_NAME)
          ? request.transaction!.objectStore(REPLAY_STORE_NAME)
          : database.createObjectStore(REPLAY_STORE_NAME, { keyPath: ["ownerId", "matchId"] });
        if (!store.indexNames.contains("ownerId")) store.createIndex("ownerId", "ownerId", { unique: false });
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error("Não foi possível abrir o banco local de replays."));
      request.onblocked = () => reject(new Error("A atualização do banco local de replays está bloqueada."));
    }).catch((error) => {
      this.databasePromise = null;
      throw error;
    });

    return this.databasePromise;
  }
}

export const replayStore = new ReplayStore();
