import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createInitialBattleState, resolveBattleTurn } from "../domain/battle";
import type { LocalReplay, ReplaySource, ReplayTurnRecord } from "../types";
import {
  ReplaySourceValidationError,
  ReplayStore,
  finalizeReplayDraft,
  mergeReplayDraft,
  mergeReplayTurns,
  selectCleanupMatchIds,
  selectFavoriteReplays,
  selectRecentReplays,
} from "./replayStore";

function makeTurn(turnNumber: number, primary = `TURNO ${turnNumber}`): ReplayTurnRecord {
  const before = createInitialBattleState();
  before.turnNumber = turnNumber;
  const result = resolveBattleTurn(before, "Poke", "Block");
  return {
    turnNumber,
    result: {
      ...result,
      primary,
      before: { ...result.before, turnNumber },
      after: { ...result.after, turnNumber: turnNumber + 1 },
    },
  };
}

function makeReplay(index = 1, overrides: Partial<LocalReplay> = {}): LocalReplay {
  const timestamp = new Date(Date.UTC(2026, 6, 13, 12, 0, index)).toISOString();
  return {
    schemaVersion: 1,
    ownerId: "owner",
    matchId: `match-${index}`,
    matchType: "ranked",
    playerSide: "p1",
    p1: {
      userId: "owner",
      displayName: "Jogador",
      characterId: "ninja",
      rankPoints: 610,
      division: "Bronze II",
    },
    p2: {
      userId: "opponent",
      displayName: "Rival",
      characterId: "aton",
      rankPoints: null,
      division: null,
    },
    winnerId: null,
    result: null,
    finishedReason: null,
    createdAt: timestamp,
    finishedAt: null,
    favorite: false,
    status: "pending",
    turns: [],
    ...overrides,
  };
}

function makeSource(overrides: Partial<ReplaySource> = {}): ReplaySource {
  return {
    matchId: "match-1",
    matchType: "private",
    player1Id: "opponent",
    player2Id: "owner",
    player1CharacterId: "doll",
    player2CharacterId: "itzcoatl",
    winnerId: "owner",
    finishedReason: "health_depleted",
    createdAt: "2026-07-13T12:00:00.000Z",
    finishedAt: "2026-07-13T12:04:00.000Z",
    turns: [makeTurn(1, "AUTORITATIVO 1"), makeTurn(2, "AUTORITATIVO 2")],
    ...overrides,
  };
}

async function saveCompleteReplay(
  store: ReplayStore,
  index: number,
  ownerId = "owner",
): Promise<LocalReplay> {
  const matchId = `match-${index}`;
  const opponentId = `opponent-${index}`;
  const draft = makeReplay(index, {
    ownerId,
    matchId,
    p1: {
      userId: ownerId,
      displayName: `Jogador ${ownerId}`,
      characterId: "ninja",
      rankPoints: 610,
      division: "Bronze II",
    },
    p2: {
      userId: opponentId,
      displayName: `Rival ${index}`,
      characterId: "aton",
      rankPoints: null,
      division: null,
    },
    turns: [makeTurn(1)],
  });
  await store.upsertDraft(draft);
  const complete = await store.finalize(ownerId, matchId, makeSource({
    matchId,
    matchType: "ranked",
    player1Id: ownerId,
    player2Id: opponentId,
    player1CharacterId: "ninja",
    player2CharacterId: "aton",
    winnerId: ownerId,
    createdAt: draft.createdAt!,
    finishedAt: new Date(Date.parse(draft.createdAt!) + 1_000).toISOString(),
    turns: [makeTurn(1)],
  }));
  return complete!;
}

describe("replay turn merging", () => {
  it("is idempotent by turn number and lets the incoming source win", () => {
    const merged = mergeReplayTurns(
      [makeTurn(2, "OBSERVADO 2"), makeTurn(1, "OBSERVADO 1")],
      [makeTurn(1, "AUTORITATIVO 1"), makeTurn(1, "AUTORITATIVO 1")],
    );

    expect(merged.map((turn) => turn.turnNumber)).toEqual([1, 2]);
    expect(merged[0].result.primary).toBe("AUTORITATIVO 1");
    expect(merged[1].result.primary).toBe("OBSERVADO 2");
  });

  it("does not overwrite an enriched ranking with a stale draft", () => {
    const enriched = makeReplay(1, {
      p2: {
        userId: "opponent",
        displayName: "Rival",
        characterId: "aton",
        rankPoints: 920,
        division: "Bronze I",
      },
    });
    const stale = makeReplay(1);

    const merged = mergeReplayDraft(enriched, stale);

    expect(merged.p2.rankPoints).toBe(920);
    expect(merged.p2.division).toBe("Bronze I");
  });
});

describe("replay retention", () => {
  it("keeps the 20 newest complete replays plus old favorites", () => {
    const replays = Array.from({ length: 22 }, (_, offset) =>
      makeReplay(offset + 1, {
        status: "complete",
        result: "win",
        finishedAt: new Date(Date.UTC(2026, 6, 13, 12, 0, offset + 1)).toISOString(),
        favorite: offset === 0,
      }),
    );

    expect(selectRecentReplays(replays)).toHaveLength(20);
    expect(selectRecentReplays(replays).map((replay) => replay.matchId)).not.toContain("match-1");
    expect(selectFavoriteReplays(replays).map((replay) => replay.matchId)).toEqual(["match-1"]);
    expect(selectCleanupMatchIds(replays)).toEqual(["match-2"]);
  });

  it("never cleans pending replays", () => {
    const oldPending = makeReplay(1);
    const complete = Array.from({ length: 21 }, (_, index) =>
      makeReplay(index + 2, { status: "complete", result: "draw", finishedAt: `2026-07-13T12:00:${String(index + 2).padStart(2, "0")}.000Z` }),
    );

    expect(selectCleanupMatchIds([oldPending, ...complete])).not.toContain(oldPending.matchId);
  });
});

describe("replay finalization", () => {
  it("uses authoritative turns and metadata without losing the favorite", () => {
    const draft = makeReplay(1, {
      playerSide: "p1",
      favorite: true,
      turns: [makeTurn(1, "OBSERVADO")],
    });

    const replay = finalizeReplayDraft(draft, makeSource());

    expect(replay.status).toBe("complete");
    expect(replay.playerSide).toBe("p2");
    expect(replay.matchType).toBe("private");
    expect(replay.result).toBe("win");
    expect(replay.favorite).toBe(true);
    expect(replay.createdAt).toBe("2026-07-13T12:00:00.000Z");
    expect(replay.finishedAt).toBe("2026-07-13T12:04:00.000Z");
    expect(replay.p1.userId).toBe("opponent");
    expect(replay.p1.displayName).toBe("Rival");
    expect(replay.p1.characterId).toBe("doll");
    expect(replay.p2.userId).toBe("owner");
    expect(replay.p2.displayName).toBe("Jogador");
    expect(replay.p2.characterId).toBe("itzcoatl");
    expect(replay.turns.map((turn) => turn.result.primary)).toEqual(["AUTORITATIVO 1", "AUTORITATIVO 2"]);
  });

  it("keeps the draft pending when an observed turn is absent from the source", () => {
    const draft = makeReplay(1, { turns: [makeTurn(3)] });
    expect(() => finalizeReplayDraft(draft, makeSource())).toThrow(ReplaySourceValidationError);
    expect(draft.status).toBe("pending");
  });

  it("rejects a source without authoritative turns", () => {
    const draft = makeReplay(1);
    expect(() => finalizeReplayDraft(draft, makeSource({ turns: [] }))).toThrow(
      "Uma partida sem turnos autoritativos não pode gerar replay.",
    );
  });
});

describe("ReplayStore IndexedDB", () => {
  it("retains the newest 20 while keeping an older favorite", async () => {
    const store = new ReplayStore(new IDBFactory());
    await saveCompleteReplay(store, 1);
    await store.toggleFavorite("owner", "match-1");
    for (let index = 2; index <= 22; index += 1) await saveCompleteReplay(store, index);

    expect(await store.listRecent("owner")).toHaveLength(20);
    expect((await store.listRecent("owner")).map((replay) => replay.matchId)).not.toContain("match-1");
    expect((await store.listFavorites("owner")).map((replay) => replay.matchId)).toEqual(["match-1"]);
    expect(await store.get("owner", "match-2")).toBeNull();
    store.close();
  });

  it("deletes an unfavorited replay outside the recent limit but keeps one inside", async () => {
    const store = new ReplayStore(new IDBFactory());
    await saveCompleteReplay(store, 1);
    await store.toggleFavorite("owner", "match-1");
    for (let index = 2; index <= 21; index += 1) await saveCompleteReplay(store, index);

    expect(await store.toggleFavorite("owner", "match-1")).toBeNull();
    expect(await store.get("owner", "match-1")).toBeNull();

    await store.toggleFavorite("owner", "match-21");
    expect((await store.toggleFavorite("owner", "match-21"))?.favorite).toBe(false);
    expect(await store.get("owner", "match-21")).not.toBeNull();
    store.close();
  });

  it("isolates accounts even when match ids are equal", async () => {
    const store = new ReplayStore(new IDBFactory());
    await saveCompleteReplay(store, 1, "owner-a");
    await saveCompleteReplay(store, 1, "owner-b");

    expect((await store.listRecent("owner-a")).map((replay) => replay.ownerId)).toEqual(["owner-a"]);
    expect((await store.listRecent("owner-b")).map((replay) => replay.ownerId)).toEqual(["owner-b"]);
    store.close();
  });

  it("persists after closing and reopening the repository", async () => {
    const indexedDB = new IDBFactory();
    const firstStore = new ReplayStore(indexedDB);
    await saveCompleteReplay(firstStore, 1);
    firstStore.close();
    await Promise.resolve();

    const reopenedStore = new ReplayStore(indexedDB);
    await expect(reopenedStore.get("owner", "match-1")).resolves.toMatchObject({
      matchId: "match-1",
      status: "complete",
    });
    reopenedStore.close();
  });
});
