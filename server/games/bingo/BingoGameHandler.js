const BaseGameHandler = require("../BaseGameHandler");
const { shuffleBag, generateCard, checkFigures } = require("./index");

class BingoGameHandler extends BaseGameHandler {
  constructor(room, io) {
    super(room);
    this.io = io;

    // Asegurar que la configuración específica de Bingo esté inicializada
    if (!this.room.config.cardsPerPlayer) {
      this.room.config.cardsPerPlayer = 1;
    }
  }

  createInitialState() {
    return {
      started: false,
      paused: true,
      bag: [],
      drawn: [],
      timer: null,
      announceTimeout: null,
      figuresClaimed: {
        corners: null,
        row: null,
        column: null,
        diagonal: null,
        border: null,
        full: null,
      },
      specificClaims: new Map(),
      playerFigures: new Map(),
      gameEnded: false,
      announcementQueue: [],
      processingAnnouncements: false,
    };
  }

  getPublicState() {
    return {
      started: this.gameState.started,
      paused: this.gameState.paused,
      drawn: this.gameState.drawn,
      lastBall: this.gameState.drawn[this.gameState.drawn.length - 1] || null,
      figuresClaimed: this.gameState.figuresClaimed,
      specificClaims: Object.fromEntries(this.gameState.specificClaims),
      gameEnded: this.gameState.gameEnded,
    };
  }

  // Configuración específica del juego de Bingo
  getGameConfig() {
    return {
      cardsPerPlayer: this.room.config.cardsPerPlayer || 1,
    };
  }

  // Configurar parámetros específicos del Bingo
  setGameConfig(newConfig) {
    // Validar y aplicar configuraciones específicas de Bingo
    if (newConfig.cardsPerPlayer !== undefined) {
      this.room.config.cardsPerPlayer = Math.max(
        1,
        Math.min(4, Number(newConfig.cardsPerPlayer) || 1)
      );
    }
    return true;
  }

  startGame() {
    this.gameState.started = true;
    this.gameState.paused = false;
    this.gameState.gameEnded = false;
    this.room.playersReady.clear();
    this.gameState.announcementQueue = [];
    this.gameState.processingAnnouncements = false;
    this.gameState.bag = shuffleBag();
    this.gameState.drawn = [];
    this.gameState.figuresClaimed = {
      corners: null,
      row: null,
      column: null,
      diagonal: null,
      border: null,
      full: null,
    };
    this.gameState.playerFigures.clear();

    // Generar cartones para todos los jugadores
    for (const p of this.room.players.values()) {
      p.cards = Array.from({ length: this.room.config.cardsPerPlayer }, () =>
        generateCard()
      );
    }

    this.stopTimer();
    this.startTimerIfNeeded();
  }

  stopTimer() {
    if (this.gameState.timer) {
      clearInterval(this.gameState.timer);
      this.gameState.timer = null;
    }
  }

  startTimerIfNeeded() {
    if (
      !this.gameState.started ||
      this.gameState.paused ||
      this.gameState.timer
    )
      return;
    const baseMs = 10000;
    const factor = Number(this.room.config.speed) || 1;
    const intervalMs = Math.max(500, Math.round(baseMs / factor));
    this.gameState.timer = setInterval(() => this.drawNextBall(), intervalMs);
  }

  drawNextBall() {
    if (!this.gameState.started || this.gameState.paused) return;
    const n = this.gameState.bag.pop();
    if (n == null) return;
    this.gameState.drawn.push(n);
    this.io.to(this.room.id).emit("ball", n);
  }

  setSpeed(speed) {
    const allowed = [0.5, 0.75, 1, 1.25, 1.5];
    const s = Number(speed);
    if (!allowed.includes(s)) return false;

    this.room.config.speed = s;
    this.stopTimer();
    this.startTimerIfNeeded();
    return true;
  }

  pauseDraw() {
    this.gameState.paused = true;
    this.stopTimer();
  }

  resumeDraw() {
    this.gameState.paused = false;
    this.stopTimer();
    this.startTimerIfNeeded();
  }

  forceNextBall() {
    this.gameState.paused = true;
    this.stopTimer();
    const n = this.gameState.bag.pop();
    if (n == null) return null;
    this.gameState.drawn.push(n);
    this.io.to(this.room.id).emit("ball", n);
    return n;
  }

  // Procesar cola de anuncios individuales
  processAnnouncementQueue() {
    if (
      this.gameState.processingAnnouncements ||
      this.gameState.announcementQueue.length === 0
    )
      return;

    this.gameState.processingAnnouncements = true;
    const announcement = this.gameState.announcementQueue.shift();

    // Pausar el juego durante el anuncio
    this.gameState.paused = true;
    this.stopTimer();

    // Enviar anuncio individual
    this.io.to(this.room.id).emit("announcement", announcement);

    // Programar siguiente anuncio o reanudar juego
    setTimeout(() => {
      this.gameState.processingAnnouncements = false;

      if (this.gameState.announcementQueue.length > 0) {
        // Continuar con el siguiente anuncio
        this.processAnnouncementQueue();
      } else {
        // No hay más anuncios, reanudar juego si no terminó
        if (!this.gameState.gameEnded) {
          this.gameState.paused = false;
          this.startTimerIfNeeded();
        }
      }
    }, 2500); // 2.5 segundos por anuncio
  }

  validateAndFlags(socketId, cardIndex, markedFromClient) {
    const player = this.room.players.get(socketId);
    if (!player) return { ok: false, reason: "player_not_found" };
    const card = player.cards?.[cardIndex];
    if (!card) return { ok: false, reason: "card_not_found" };

    let marked = markedFromClient;
    if (
      !Array.isArray(marked) ||
      marked.length !== 5 ||
      marked.some((row) => !Array.isArray(row) || row.length !== 5)
    ) {
      return { ok: false, reason: "invalid_marked" };
    }

    const drawnSet = new Set(this.gameState.drawn);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const isCenter = r === 2 && c === 2;
        if (isCenter) {
          if (!marked[r][c]) marked[r][c] = true;
          continue;
        }
        if (marked[r][c]) {
          const value = card[r][c];
          if (!drawnSet.has(value)) {
            return { ok: false, reason: "marked_not_drawn" };
          }
        }
      }
    }

    const flags = checkFigures(marked);
    return { ok: true, flags };
  }

  buildClaimDetails(figure, marked) {
    const details = {};
    if (!marked) return details;
    switch (figure) {
      case "row": {
        for (let r = 0; r < 5; r++) {
          if (marked[r].every(Boolean)) {
            details.row = r;
            break;
          }
        }
        break;
      }
      case "column": {
        for (let c = 0; c < 5; c++) {
          if ([0, 1, 2, 3, 4].every((i) => marked[i][c])) {
            details.column = c;
            break;
          }
        }
        break;
      }
      case "diagonal": {
        const d1 = [0, 1, 2, 3, 4].every((i) => marked[i][i]);
        const d2 = [0, 1, 2, 3, 4].every((i) => marked[i][4 - i]);
        if (d1) details.diagonal = 0;
        else if (d2) details.diagonal = 1;
        break;
      }
      case "border": {
        details.border = true;
        break;
      }
      case "corners": {
        details.corners = true;
        break;
      }
      case "full": {
        details.full = true;
        break;
      }
    }
    return details;
  }

  checkClaim(
    socketId,
    figure,
    cardIndex,
    markedFromClient,
    statsService,
    dataStore,
    isDebugMode = false
  ) {
    if (this.gameState.figuresClaimed[figure])
      return { ok: false, reason: "figure_taken" };

    let valid;
    if (isDebugMode) {
      // En modo debug, siempre validar como correcto
      valid = { ok: true, flags: { [figure]: true } };
      console.log(`🐛 DEBUG MODE: Auto-validating claim for figure: ${figure}`);
    } else {
      // Validación normal
      valid = this.validateAndFlags(socketId, cardIndex, markedFromClient);
      if (!valid.ok) return valid;
    }

    const { flags } = valid;
    if (!flags[figure]) return { ok: false, reason: "invalid" };

    this.gameState.figuresClaimed[figure] = socketId;

    // Rastrear figura completada por jugador
    try {
      const player = this.room.players.get(socketId);
      const pid = player?.username || socketId;

      if (!this.gameState.playerFigures.has(pid)) {
        this.gameState.playerFigures.set(pid, new Set());
      }
      this.gameState.playerFigures.get(pid).add(figure);
    } catch (e) {
      console.error("Error tracking player figure:", e);
    }

    // Registrar reclamo específico con detalles
    try {
      const details = this.buildClaimDetails(figure, markedFromClient);
      const claimKey = `${socketId}:${cardIndex}:${figure}`;
      const player = this.room.players.get(socketId) || {};
      this.gameState.specificClaims.set(claimKey, {
        playerId: socketId,
        cardIndex,
        figure,
        details,
        playerName: player.name,
        timestamp: Date.now(),
      });

      // Encolar anuncio individual
      this.gameState.announcementQueue.push({
        roomId: this.room.id,
        playerId: socketId,
        playerName: player.name,
        playerUsername: player.username,
        playerAvatarId: player.avatarId,
        figures: [figure],
        cardIndex,
      });
    } catch (e) {
      console.warn("Failed to build claim details:", e);
    }

    // Procesar cola de anuncios
    this.processAnnouncementQueue();

    if (figure === "full") {
      this.endGame(socketId, statsService, dataStore);
    }

    return { ok: true };
  }

  autoClaim(socketId, cardIndex, markedFromClient, statsService, dataStore) {
    const valid = this.validateAndFlags(socketId, cardIndex, markedFromClient);
    if (!valid.ok) return valid;

    const { flags } = valid;
    const player = this.room.players.get(socketId) || {};

    const newly = Object.keys(this.gameState.figuresClaimed)
      .filter((k) => !this.gameState.figuresClaimed[k])
      .filter((k) => flags[k]);

    if (newly.length === 0) return { ok: false, reason: "no_new_figures" };

    // Marcar figuras como completadas
    for (const f of newly) {
      this.gameState.figuresClaimed[f] = socketId;

      const claimKey = `${socketId}:${cardIndex}:${f}`;
      const details = this.buildClaimDetails(f, markedFromClient);
      this.gameState.specificClaims.set(claimKey, {
        playerId: socketId,
        cardIndex: cardIndex,
        figure: f,
        details,
        playerName: player.name,
        timestamp: Date.now(),
      });

      try {
        const pid = player?.username || socketId;
        if (!this.gameState.playerFigures.has(pid)) {
          this.gameState.playerFigures.set(pid, new Set());
        }
        this.gameState.playerFigures.get(pid).add(f);
      } catch (e) {
        console.error("Error tracking player figure:", e);
      }
    }

    // Crear anuncios individuales por prioridad
    const priorityOrder = [
      "full",
      "border",
      "diagonal",
      "corners",
      "column",
      "row",
    ];
    const sortedFigures = newly.sort((a, b) => {
      return priorityOrder.indexOf(a) - priorityOrder.indexOf(b);
    });

    sortedFigures.forEach((figure) => {
      this.gameState.announcementQueue.push({
        roomId: this.room.id,
        playerId: socketId,
        playerName: player.name,
        playerUsername: player.username,
        playerAvatarId: player.avatarId,
        figures: [figure],
        cardIndex,
      });
    });

    if (newly.includes("full")) {
      this.endGame(socketId, statsService, dataStore);
    }

    this.processAnnouncementQueue();

    return { ok: true, figures: newly };
  }

  endGame(winnerId, statsService, dataStore) {
    this.gameState.gameEnded = true;
    this.room.gameEnded = true;
    this.stopTimer();

    // Registrar estadísticas del juego
    const pending = this.gameState.announcementQueue.length;
    setTimeout(() => {
      try {
        const winner = this.room.players.get(winnerId);
        const winnerUsername = winner?.username || winnerId;

        const playersWithFigures = {};
        for (const [
          playerId,
          figuresSet,
        ] of this.gameState.playerFigures.entries()) {
          playersWithFigures[playerId] = Array.from(figuresSet);
        }

        // Registrar en dataStore y base de datos
        const gameResult = {
          gameKey: this.room.gameKey,
          roomId: this.room.id,
          winnerId: winnerUsername,
          playersWithFigures,
        };

        dataStore.recordGameResult(gameResult);
        statsService.recordGameResult(gameResult);

        this.io.to(this.room.id).emit("gameOver", {
          roomId: this.room.id,
          winner: winnerId,
          figuresClaimed: this.gameState.figuresClaimed,
          players: Array.from(this.room.players.entries()).map(([sid, p]) => ({
            id: sid,
            name: p.name,
            avatarUrl: p.avatarUrl,
          })),
        });
      } catch (e) {
        console.error("Error recording game result:", e);
      }
    }, pending * 2500 + 1000);
  }

  cleanup() {
    this.stopTimer();
    if (this.gameState.announceTimeout) {
      clearTimeout(this.gameState.announceTimeout);
    }
  }
}

module.exports = BingoGameHandler;
