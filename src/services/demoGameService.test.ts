import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoGameService } from "./demoGameService";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("DemoGameService replay source", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unlocks newly added default characters in existing demo saves", async () => {
    window.localStorage.setItem("finalGenesis.demoState", JSON.stringify({
      unlockedCharacterIds: ["ninja", "itzcoatl", "aton", "doll"],
    }));

    const snapshot = await new DemoGameService().getSnapshot();

    expect(snapshot.unlockedCharacterIds).toContain("iop");
  });

  it("keeps resolved turns after the current match changes and after sign out", async () => {
    const service = new DemoGameService();
    await service.signInWithGoogle();
    const ownerId = (await service.getSnapshot()).profile!.id;
    const queued = await service.joinRankedQueue();
    const match = queued.match!;
    await service.selectMatchCharacter(match.id, "ninja");
    await service.submitAction(match.id, "Poke");

    const source = await service.getReplaySource(match.id);
    expect(source.player1CharacterId).toBe("ninja");
    expect(source.player2CharacterId).toBeTruthy();
    expect(source.turns).toHaveLength(1);
    expect(source.turns[0].result.before.turnNumber).toBe(1);

    await service.postMatchChoice(match.id, "again");
    await service.signOut();
    await service.signInWithGoogle();

    expect((await service.getSnapshot()).profile!.id).toBe(ownerId);
    await expect(service.getReplaySource(match.id)).resolves.toMatchObject({
      matchId: match.id,
      turns: [{ turnNumber: 1 }],
    });
  });

  it("bounds authoritative demo replay sources stored in localStorage", async () => {
    const service = new DemoGameService();
    await service.signInWithGoogle();
    const matchIds: string[] = [];

    for (let index = 0; index < 26; index += 1) {
      const match = (await service.joinRankedQueue()).match!;
      matchIds.push(match.id);
      await service.selectMatchCharacter(match.id, "ninja");
    }

    const stored = JSON.parse(window.localStorage.getItem("finalGenesis.demoState") || "{}") as {
      replayMatches?: Record<string, unknown>;
    };
    expect(Object.keys(stored.replayMatches || {})).toHaveLength(25);
    expect(stored.replayMatches).not.toHaveProperty(matchIds[0]);
    expect(stored.replayMatches).toHaveProperty(matchIds.at(-1)!);
  });
});
