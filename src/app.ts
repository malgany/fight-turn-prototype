import { characterById, characters } from "./data/characters";
import { selectableActions, turnDurationForState } from "./domain/battle";
import type { Action, AppSnapshot, GameMatch, LeaderboardEntry, MatchHistoryEntry, PrivateRoom } from "./types";
import type { GameService } from "./services/gameService";

type Screen =
  | "login"
  | "menu"
  | "profile"
  | "character-select"
  | "online"
  | "ranked-queue"
  | "private-room"
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

function shortAccountLabel(snapshot: AppSnapshot): string {
  if (!snapshot.profile) return "";
  return "Google";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function countdown(deadline: string): string {
  const remaining = Math.max(0, new Date(deadline).getTime() - Date.now());
  return String(Math.ceil(remaining / 1000));
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
    room: null,
    match: null,
  };

  private heartbeatId: number | null = null;
  private pollId: number | null = null;
  private timerId: number | null = null;
  private unsubscribeMatch: (() => void) | null = null;
  private unsubscribePrivateRoom: (() => void) | null = null;

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
    this.render();
  }

  private bindEvents(): void {
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
    const match = await this.service.getCurrentMatch().catch(() => null);
    if (match?.status === "active") this.enterMatch(match);
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
    this.state.error = null;
    this.state.info = null;

    if (screen === "ranking") {
      await this.run("Carregando ranking...", async () => {
        this.state.leaderboard = await this.service.getLeaderboard();
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
        this.state.match = null;
        await this.navigate("online");
        break;
      case "legacy-menu":
        window.location.assign("/");
        break;
    }
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

  private enterMatch(match: GameMatch): void {
    this.clearPolling();
    this.state.match = match;
    this.state.screen = match.status === "finished" || match.status === "forfeited" ? "post-match" : "battle";
    this.unsubscribeMatch?.();
    this.unsubscribeMatch = this.service.watchMatch(match.id, () => {
      void this.refreshMatch();
    });
    void this.service.heartbeat("in_match", match.id);
  }

  private async refreshMatch(): Promise<void> {
    const match = await this.service.getCurrentMatch();
    if (match) {
      this.state.match = match;
      if (match.status === "finished" || match.status === "forfeited") this.state.screen = "post-match";
      this.render();
    }
  }

  private async submitMatchAction(action: Action): Promise<void> {
    if (!this.state.match) return;
    await this.run("Enviando acao...", async () => {
      const match = await this.service.submitAction(this.state.match!.id, action);
      this.enterMatch(match);
    });
  }

  private async forfeit(): Promise<void> {
    if (!this.state.match) return;
    await this.run("Abandonando partida...", async () => {
      const match = await this.service.forfeitMatch(this.state.match!.id);
      this.enterMatch(match);
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatId = window.setInterval(() => {
      const status = this.state.screen === "ranked-queue" ? "in_queue" : this.state.screen === "battle" ? "in_match" : "online";
      void this.service.heartbeat(status, this.state.match?.id).catch(() => undefined);
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatId) window.clearInterval(this.heartbeatId);
    this.heartbeatId = null;
  }

  private startMatchPolling(): void {
    this.clearPolling();
    this.pollId = window.setInterval(async () => {
      const match = await this.service.getCurrentMatch().catch(() => null);
      if (match) this.enterMatch(match);
    }, 2_000);
  }

  private startRoomPolling(code: string): void {
    this.clearPolling();
    const pollRoom = async () => {
      const currentMatch = await this.service.getCurrentMatch().catch(() => null);
      if (currentMatch?.matchType === "private" && currentMatch.status === "active") {
        this.enterMatch(currentMatch);
      }
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
    this.unsubscribePrivateRoom?.();
    this.unsubscribePrivateRoom = null;
  }

  private render(): void {
    this.root.innerHTML = `
      <main class="app-shell">
        ${this.state.snapshot.profile ? this.renderTopBar() : ""}
        <div class="app-content">
          ${this.renderStatus()}
          ${this.renderScreen()}
        </div>
      </main>
    `;
    this.bindRenderedControls();
    this.startUiTimer();
  }

  private bindRenderedControls(): void {
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
      if (clock && this.state.match) {
        clock.textContent = countdown(this.state.match.turnDeadlineAt);
      }
    }, 250);
  }

  private renderTopBar(): string {
    const { profile, rank } = this.state.snapshot;
    if (!profile) return "";
    return `
      <header class="top-bar">
        <button class="brand-button" data-nav="menu" type="button">
          <img src="/assets/ui/menu/logo.webp" alt="Final Genesis">
        </button>
        <div class="player-chip">
          <span class="presence-dot ${profile.presenceStatus}"></span>
          <span>${escapeHtml(profile.displayName)}</span>
          <small>${shortAccountLabel(this.state.snapshot)}${rank ? ` · ${rank.division} ${rank.rankPoints}` : ""}</small>
        </div>
      </header>
    `;
  }

  private renderStatus(): string {
    const demo = this.service.mode === "demo"
      ? `<div class="banner warning">Modo local: configure <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> para usar o backend real.</div>`
      : "";
    return `
      ${demo}
      ${this.state.loading ? `<div class="banner loading">${escapeHtml(this.state.info || "Carregando...")}</div>` : ""}
      ${this.state.error ? `<div class="banner error">${escapeHtml(this.state.error)}</div>` : ""}
      ${this.state.info && !this.state.loading ? `<div class="banner info">${escapeHtml(this.state.info)}</div>` : ""}
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
      case "battle":
        return this.renderBattle();
      case "post-match":
        return this.renderPostMatch();
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
          <img src="/assets/ui/menu/logo.webp" alt="Final Genesis" class="login-logo">
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
          <button class="image-command" data-action="legacy-menu" type="button">Voltar</button>
        </nav>
      </section>
    `;
  }

  private renderProfile(): string {
    const { profile, rank } = this.state.snapshot;
    if (!profile || !rank) return "";
    const selected = characterById(profile.selectedCharacterId);
    return `
      <section class="screen-band">
        <div class="section-heading">
          <h1>Perfil</h1>
          <button class="ghost-command" data-nav="menu" type="button">Voltar</button>
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
            <span><strong>${selected.name}</strong> Personagem</span>
          </div>
          <div class="button-row">
            <button class="primary-command" data-nav="character-select" type="button">Selecionar personagem</button>
            <button class="danger-command" data-action="logout" type="button">Sair</button>
          </div>
        </div>
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
          ${characters.map((character) => {
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
      <section class="screen-band">
        <div class="section-heading">
          <h1>Online</h1>
          <button class="ghost-command" data-nav="menu" type="button">Voltar</button>
        </div>
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
      </section>
    `;
  }

  private renderRankedQueue(): string {
    return `
      <section class="queue-screen">
        <div class="queue-pulse"></div>
        <h1>Procurando adversario</h1>
        <p>Seu personagem selecionado sera usado quando a partida for encontrada.</p>
        <button class="danger-command" data-action="cancel-queue" type="button">Cancelar fila</button>
      </section>
    `;
  }

  private renderPrivateRoom(): string {
    const room = this.state.room;
    if (!room) return "";
    return `
      <section class="screen-band">
        <div class="section-heading">
          <h1>Sala privada</h1>
          <button class="ghost-command" data-nav="online" type="button">Voltar</button>
        </div>
        <div class="room-panel">
          <span class="room-code">${escapeHtml(room.code)}</span>
          <p>Envie este codigo ou link para o adversario entrar.</p>
          <p>Host: ${escapeHtml(room.hostName)} · Visitante: ${room.guestName ? escapeHtml(room.guestName) : "aguardando"}</p>
          <div class="button-row">
            <button class="secondary-command" data-action="copy-room" type="button">Copiar link</button>
            <button class="ghost-command" data-nav="online" type="button">Sair da sala</button>
          </div>
        </div>
      </section>
    `;
  }

  private renderBattle(): string {
    const match = this.state.match;
    if (!match) return "";
    const p1Character = characterById(match.p1.characterId);
    const p2Character = characterById(match.p2.characterId);
    const playerState = match.battleState[match.playerSide];
    const canAct = match.status === "active" && !match.localAction;
    return `
      <section class="battle-screen">
        <div class="battle-hud">
          ${this.renderFighterHud(match.p1.displayName, p1Character.portraitUrl, match.battleState.p1.health, match.battleState.p1.super)}
          <div class="round-clock" data-turn-clock>${countdown(match.turnDeadlineAt)}</div>
          ${this.renderFighterHud(match.p2.displayName, p2Character.portraitUrl, match.battleState.p2.health, match.battleState.p2.super)}
        </div>
        <div class="arena">
          <img class="fighter-art left" src="${p1Character.portraitUrl}" alt="">
          <div class="versus-column">
            <span>${match.lastTurn ? escapeHtml(match.lastTurn.primary) : "READY"}</span>
            <small>${match.localAction ? "Voce escolheu" : "Escolha sua acao"} · ${match.opponentHasAction ? "adversario escolheu" : "aguardando adversario"}</small>
          </div>
          <img class="fighter-art right" src="${p2Character.portraitUrl}" alt="">
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
          <button class="primary-command" data-action="play-again" type="button">Jogar novamente</button>
          <button class="secondary-command" data-nav="online" type="button">Voltar ao lobby</button>
          <button class="ghost-command" data-nav="menu" type="button">Voltar ao menu</button>
        </div>
      </section>
    `;
  }

  private renderRanking(): string {
    return `
      <section class="screen-band">
        <div class="section-heading">
          <h1>Ranking</h1>
          <button class="ghost-command" data-nav="menu" type="button">Voltar</button>
        </div>
        <div class="table-list">
          ${this.state.leaderboard.length ? this.state.leaderboard.map((entry) => `
            <div class="table-row ${entry.userId === this.state.snapshot.profile?.id ? "current" : ""}">
              <strong>#${entry.position} ${escapeHtml(entry.displayName)}</strong>
              <span>${entry.division}</span>
              <span>${entry.rankPoints} pts</span>
              <span>${entry.wins}V/${entry.losses}D</span>
              <span>Streak ${entry.streak}</span>
            </div>
          `).join("") : `<p class="empty-state">Ranking vazio.</p>`}
        </div>
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
