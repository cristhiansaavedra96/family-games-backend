const BaseGameHandler = require("../BaseGameHandler");
const TurnManager = require("../../shared/TurnManager");
const statsService = require("../../services/statsService");
const {
  buildDeck,
  shuffle,
  initialGameState,
  dealInitialHands,
  drawOne,
  reshuffleFromDiscard,
  topDiscard,
  canPlayCard,
  applyCardEffects,
  randomColor,
  calculateHandPoints,
} = require("./logic");

class UnoGameHandler extends BaseGameHandler {
  constructor(room, io) {
    room.config = room.config || {};
    room.config.maxPlayers = room.config.maxPlayers || 6; // por ahora 2-6
    room.config.playerCount = room.players?.size || 0;

    super(room);
    this.io = io;

    // Configuración específica de UNO
    if (!this.room.config.pointsToWin) {
      this.room.config.pointsToWin = 500; // Valor por defecto
    }

    this.turnManager = new TurnManager({
      maxSkips: 1,
      onTurnChange: (info) => {
        this.gameState.currentPlayer = info.currentPlayer;
        this.emitTurn(info.previousPlayer, info.currentPlayer);
      },
      onDirectionChange: (dir) => {
        this.io.to(this.room.id).emit("directionChanged", {
          direction: dir === 1 ? "clockwise" : "counterclockwise",
        });
      },
      onPlayerSkipped: (skippedPlayer, nextPlayer) => {
        this.io.to(this.room.id).emit("playerSkipped", {
          skippedPlayer,
          nextPlayer,
        });
      },
    });

    // Control de UNO (decir UNO y acusaciones)
    this.unoState = {
      // playerId -> { declared:boolean, atOneSince:number, penalized:boolean }
      players: new Map(),
      graceMs: 2000, // 2 segundos de gracia para decir UNO
    };

    // Timers para ventanas de reclamo de UNO
    this.unoClaimTimers = new Map(); // playerId -> timeoutId

    // Estado para challenge de wild draw 4
    this.wild4Challenge = null; // { playedBy, targetPlayer, snapshotHand, chosenColor, createdAt, timeoutAt, resolved }
  }

  createInitialState() {
    return initialGameState();
  }

  getGameConfig() {
    return {
      gameKey: "uno",
      pointsToWin: this.room.config.pointsToWin || 500,
    };
  }

  setGameConfig(newConfig) {
    // Validar y aplicar configuraciones específicas de UNO
    if (newConfig.pointsToWin !== undefined) {
      const allowed = [300, 500, 700];
      const points = Number(newConfig.pointsToWin);
      if (allowed.includes(points)) {
        this.room.config.pointsToWin = points;
      }
    }
    return true;
  }

  startGame() {
    if (this.gameState.started) return false;

    const playerIds = Array.from(this.room.players.keys());
    if (playerIds.length < 2) return false;

    // Inicializar
    this.gameState = Object.assign(this.gameState, initialGameState());
    this.gameState.started = true;
    this.gameState.players = playerIds;

    // Inicializar puntos si es la primera partida
    if (
      !this.gameState.scores ||
      Object.keys(this.gameState.scores).length === 0
    ) {
      this.gameState.scores = {};
      this.gameState.eliminatedPlayers = new Set();
      // Inicializar índice del jugador inicial aleatorio para la primera partida
      this.gameState.startingPlayerIndex = Math.floor(
        Math.random() * playerIds.length
      );
      playerIds.forEach((pid) => {
        this.gameState.scores[pid] = 0;
      });
    }

    // Limpiar jugadores nuevos que no estén en scores
    playerIds.forEach((pid) => {
      if (!(pid in this.gameState.scores)) {
        this.gameState.scores[pid] = 0;
      }
    });

    let deck = buildDeck();
    shuffle(deck);
    this.gameState.drawPile = deck;
    dealInitialHands(this.gameState, playerIds, 7);

    // Voltear primera carta - ahora puede ser cualquier carta
    let first = deck.pop();
    this.gameState.discardPile.push(first);

    // Asignar color inicial - siempre aleatorio para wild/wild_draw4
    if (first.kind === "wild" || first.kind === "wild_draw4") {
      this.gameState.currentColor = randomColor();
    } else {
      this.gameState.currentColor = first.color;
    }
    this.gameState.currentKind = first.kind;
    this.gameState.currentValue = first.value;

    // Inicializar turnos primero
    this.turnManager.initialize(playerIds);

    // Usar el índice del jugador inicial guardado
    const startingPlayer = playerIds[this.gameState.startingPlayerIndex];
    this.turnManager.setCurrentPlayer(startingPlayer);

    // Efecto inicial si aplica
    if (["skip", "reverse", "draw2", "wild_draw4"].includes(first.kind)) {
      if (first.kind === "reverse" && playerIds.length === 2) {
        // Reverse con 2 jugadores actúa como skip
        this.turnManager.skipNext();
      } else if (first.kind === "skip") {
        this.turnManager.skipNext();
      } else if (first.kind === "reverse") {
        this.turnManager.reverseDirection();
      } else if (first.kind === "draw2") {
        this.gameState.pendingDrawType = "draw2";
        this.gameState.pendingDrawCount = 2;
      } else if (first.kind === "wild_draw4") {
        // Si empieza con +4, el primer jugador debe robar 4
        this.gameState.pendingDrawType = "wild_draw4";
        this.gameState.pendingDrawCount = 4;
      }
    }

    this.gameState.currentPlayer = this.turnManager.getCurrentPlayer();

    // Broadcast manos privadas iniciales
    this.sendPrivateHands();

    // Emitir que el juego ha comenzado
    this.io.to(this.room.id).emit("gameStarted", {
      players: this.gameState.players,
      firstCard: first,
      currentPlayer: this.gameState.currentPlayer,
    });

    // Enviar estado público actualizado inmediatamente
    this.broadcastPublicState();

    return true;
  }

  // Enviar manos privadas a cada jugador
  sendPrivateHands() {
    for (const pid of this.gameState.players) {
      const hand = this.gameState.hands[pid] || [];
      this.io.to(pid).emit("privateHand", { hand });
    }
  }

  getPlayerIndex(socketId) {
    return this.gameState.players.indexOf(socketId);
  }

  // (Se unifica implementación al final del archivo con info adicional UNO)

  emitTurn(previousPlayer, currentPlayer) {
    const info = {
      previousPlayer,
      currentPlayer,
      direction: this.turnManager.getState().direction,
      pendingDrawCount: this.gameState.pendingDrawCount,
      pendingDrawType: this.gameState.pendingDrawType,
    };
    this.io.to(this.room.id).emit("turnChanged", info);
  }

  async playCard(socketId, cardId, chosenColor) {
    if (!this.gameState.started || this.gameState.gameEnded)
      return { ok: false, reason: "not_started" };
    if (this.gameState.currentPlayer !== socketId)
      return { ok: false, reason: "not_your_turn" };

    const hand = this.gameState.hands[socketId];
    if (!hand) return { ok: false, reason: "hand_not_found" };
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return { ok: false, reason: "card_not_in_hand" };
    const card = hand[idx];
    // Snapshot previo de la mano (para challenge wild4) antes de remover la carta
    const prePlayHandSnapshot = hand.map((c) => ({
      id: c.id,
      color: c.color,
      kind: c.kind,
      value: c.value,
    }));
    const previousTop = topDiscard(this.gameState);

    if (!canPlayCard(this.gameState, card, socketId)) {
      console.log("[UNO][playCard][reject]", {
        player: socketId,
        card: {
          id: card.id,
          color: card.color,
          kind: card.kind,
          value: card.value,
        },
        state: {
          currentColor: this.gameState.currentColor,
          currentKind: this.gameState.currentKind,
          currentValue: this.gameState.currentValue,
          pendingDrawType: this.gameState.pendingDrawType,
          pendingDrawCount: this.gameState.pendingDrawCount,
        },
      });
      return { ok: false, reason: "invalid_play" };
    }

    // Quitar carta de la mano y poner en discard
    hand.splice(idx, 1);
    this.gameState.discardPile.push(card);

    // Si había stacking y se juega carta válida del mismo tipo, acumula; si no, se limpia antes
    if (this.gameState.pendingDrawCount > 0) {
      // Solo llegamos aquí si card.kind coincide (validación hecha por canPlayCard)
      // No limpiamos todavía, se acumulará en applyCardEffects
    } else {
      // Resetear cualquier estado de draw pendiente
      this.gameState.pendingDrawType = null;
      this.gameState.pendingDrawCount = 0;
    }

    // Guardar color vigente antes de aplicar efectos (para challenge wild +4)
    const prevColorBeforePlay = this.gameState.currentColor;
    const effects = applyCardEffects(this.gameState, card, chosenColor);

    // Iniciar ventana de challenge si es wild_draw4
    if (card.kind === "wild_draw4") {
      const nextPlayer = this.turnManager.getNextPlayer();
      // Snapshot antes de jugar la carta (sin excluir la carta jugada) -> removemos luego
      const snapshotHand = prePlayHandSnapshot.filter((c) => c.id !== card.id);
      this.wild4Challenge = {
        playedBy: socketId,
        targetPlayer: nextPlayer,
        snapshotHand, // mano restante del jugador tras jugar
        chosenColor: this.gameState.currentColor,
        previousColor: prevColorBeforePlay || null,
        previousTopCard: previousTop
          ? {
              color: previousTop.color,
              kind: previousTop.kind,
              value: previousTop.value,
            }
          : null,
        createdAt: Date.now(),
        timeoutAt: null, // Sin timeout automático
        resolved: false,
        eligibleChallengers: this.gameState.players.filter(
          (pid) => pid !== socketId
        ), // Todos excepto quien jugó
      };

      console.log("[UNO][Challenge] wild4Challenge created:", {
        playedBy: socketId,
        targetPlayer: nextPlayer,
        eligibleChallengers: this.wild4Challenge.eligibleChallengers,
        allPlayers: this.gameState.players,
      });

      this.io.to(this.room.id).emit("wild4ChallengeAvailable", {
        playedBy: socketId,
        targetPlayer: nextPlayer,
        eligibleChallengers: this.wild4Challenge.eligibleChallengers,
        deadline: null, // Sin deadline
      });
    } else {
      // Si se juega otra carta, limpiar challenge previo pendiente no resuelto
      if (this.wild4Challenge && !this.wild4Challenge.resolved) {
        this.wild4Challenge.resolved = true; // expirado implícitamente
      }
    }

    // Verificar victoria de ronda
    if (hand.length === 0) {
      console.log(`[UNO] Player ${socketId} won the round!`);
      this.gameState.roundWinner = socketId;

      // Verificar si estamos en modo de puntos
      const pointsToWin = this.room.config.pointsToWin;
      console.log(
        `[UNO] Points mode: ${pointsToWin ? pointsToWin : "disabled"}`
      );

      if (pointsToWin) {
        // Modo de puntos - pero primero emitir estado actualizado
        this.broadcastPublicState();
        await this.handleRoundEnd(socketId);
      } else {
        // Modo clásico - terminar juego inmediatamente
        this.gameState.gameEnded = true;
        this.gameState.winner = socketId;
        this.room.gameEnded = true;
        // Emitir estado actualizado antes del winner
        this.broadcastPublicState();
        this.io.to(this.room.id).emit("winner", { playerId: socketId });
      }

      return { ok: true, roundWinner: socketId };
    }

    // Actualizar estado UNO para este jugador tras jugar
    this.updateUnoStateFor(socketId);

    // Avanzar turno
    this.advanceTurnAfterPlay(card, effects);

    // Enviar manos privadas actualizadas solo al jugador
    this.io.to(socketId).emit("privateHand", { hand });

    // Enviar estado público actualizado a todos los jugadores
    this.broadcastPublicState();

    return { ok: true };
  }

  // Manejar el final de una ronda
  async handleRoundEnd(roundWinner) {
    console.log(`[UNO] handleRoundEnd called for winner: ${roundWinner}`);

    // Calcular puntos de todos los jugadores
    const roundScores = {};

    this.gameState.players.forEach((pid) => {
      if (pid === roundWinner) {
        roundScores[pid] = 0; // El ganador no suma puntos
      } else {
        const hand = this.gameState.hands[pid] || [];
        const points = calculateHandPoints(hand);
        roundScores[pid] = points;

        // Sumar puntos al acumulado
        this.gameState.scores[pid] = (this.gameState.scores[pid] || 0) + points;
      }
    });

    console.log(`[UNO] Round scores:`, roundScores);
    console.log(`[UNO] Total scores:`, this.gameState.scores);

    // Crear lista de jugadores ordenados por puntos totales
    const playersWithScores = this.gameState.players
      .map((pid) => {
        const player = this.room.players.get(pid) || {};
        return {
          id: pid,
          name: player.name || player.username || `Jugador ${pid.slice(-4)}`,
          username: player.username,
          avatarId: player.avatarId,
          roundPoints: roundScores[pid] || 0,
          totalPoints: this.gameState.scores[pid] || 0,
          isWinner: pid === roundWinner,
          isEliminated: this.gameState.eliminatedPlayers.has(pid),
        };
      })
      .sort((a, b) => a.totalPoints - b.totalPoints); // Ordenar por menor puntaje total

    // Verificar eliminaciones
    const pointsToWin = this.room.config.pointsToWin || 500;
    let newlyEliminated = [];

    this.gameState.players.forEach((pid) => {
      if (
        this.gameState.scores[pid] >= pointsToWin &&
        !this.gameState.eliminatedPlayers.has(pid)
      ) {
        this.gameState.eliminatedPlayers.add(pid);
        newlyEliminated.push(pid);
      }
    });

    // Verificar si queda solo un jugador sin eliminar (ganador final)
    const remainingPlayers = this.gameState.players.filter(
      (pid) => !this.gameState.eliminatedPlayers.has(pid)
    );

    if (remainingPlayers.length <= 1) {
      // Fin del juego
      this.gameState.gameEnded = true;
      this.gameState.winner = remainingPlayers[0] || null;
      this.room.gameEnded = true;

      // Guardar estadísticas del juego
      await this.saveGameStats(this.gameState.winner);

      this.io.to(this.room.id).emit("roundEnd", {
        roundWinner,
        playersWithScores,
        newlyEliminated,
        isGameEnd: true,
        finalWinner: this.gameState.winner,
      });

      // Emitir evento de fin de juego después de mostrar resultado de ronda
      setTimeout(() => {
        this.io
          .to(this.room.id)
          .emit("winner", { playerId: this.gameState.winner });
      }, 10000);
    } else {
      // Continuar con siguiente ronda
      console.log(`[UNO] Emitting roundEnd event to room ${this.room.id}`);

      this.io.to(this.room.id).emit("roundEnd", {
        roundWinner,
        playersWithScores,
        newlyEliminated,
        isGameEnd: false,
        nextRoundCountdown: 10,
      });

      // Iniciar siguiente ronda después del countdown
      setTimeout(() => {
        this.startNextRound();
      }, 10000);
    }
  }

  // Iniciar la siguiente ronda
  startNextRound() {
    // Limpiar estados de la ronda anterior
    this.gameState.started = true;
    this.gameState.hands = {};
    this.gameState.drawPile = [];
    this.gameState.discardPile = [];
    this.gameState.currentPlayer = null;
    this.gameState.pendingDrawCount = 0;
    this.gameState.pendingDrawType = null;
    this.gameState.roundWinner = null;
    this.wild4Challenge = null;
    this.unoState.players.clear();

    // Limpiar timers de ventanas de reclamo UNO
    for (const timerId of this.unoClaimTimers.values()) {
      clearTimeout(timerId);
    }
    this.unoClaimTimers.clear();

    // Solo jugadores no eliminados
    const activePlayers = this.gameState.players.filter(
      (pid) => !this.gameState.eliminatedPlayers.has(pid)
    );

    if (activePlayers.length < 2) {
      // No hay suficientes jugadores para continuar
      return;
    }

    let deck = buildDeck();
    shuffle(deck);
    this.gameState.drawPile = deck;
    dealInitialHands(this.gameState, activePlayers, 7);

    // Voltear primera carta - ahora puede ser cualquier carta
    let first = deck.pop();
    this.gameState.discardPile.push(first);

    // Asignar color inicial - siempre aleatorio para wild/wild_draw4
    if (first.kind === "wild" || first.kind === "wild_draw4") {
      this.gameState.currentColor = randomColor();
    } else {
      this.gameState.currentColor = first.color;
    }
    this.gameState.currentKind = first.kind;
    this.gameState.currentValue = first.value;

    // Inicializar turnos primero
    this.turnManager.initialize(activePlayers);

    // Rotar al siguiente jugador para la nueva ronda
    // Encontrar el índice actual en la lista de jugadores activos y rotar
    const allPlayers = this.gameState.players; // Lista original de jugadores
    let currentStarterIndex = this.gameState.startingPlayerIndex;

    // Buscar el siguiente jugador no eliminado comenzando desde el índice actual
    let nextStarterIndex = (currentStarterIndex + 1) % allPlayers.length;
    while (this.gameState.eliminatedPlayers.has(allPlayers[nextStarterIndex])) {
      nextStarterIndex = (nextStarterIndex + 1) % allPlayers.length;
    }

    // Actualizar el índice del jugador inicial
    this.gameState.startingPlayerIndex = nextStarterIndex;
    const startingPlayer = allPlayers[nextStarterIndex];
    this.turnManager.setCurrentPlayer(startingPlayer);

    // Efecto inicial si aplica
    if (["skip", "reverse", "draw2", "wild_draw4"].includes(first.kind)) {
      if (first.kind === "reverse" && activePlayers.length === 2) {
        // Reverse con 2 jugadores actúa como skip
        this.turnManager.skipNext();
      } else if (first.kind === "skip") {
        this.turnManager.skipNext();
      } else if (first.kind === "reverse") {
        this.turnManager.reverseDirection();
      } else if (first.kind === "draw2") {
        this.gameState.pendingDrawType = "draw2";
        this.gameState.pendingDrawCount = 2;
      } else if (first.kind === "wild_draw4") {
        // Si empieza con +4, el primer jugador debe robar 4
        this.gameState.pendingDrawType = "wild_draw4";
        this.gameState.pendingDrawCount = 4;
      }
    }

    this.gameState.currentPlayer = this.turnManager.getCurrentPlayer();

    // Broadcast manos privadas iniciales
    this.sendPrivateHands();

    this.io.to(this.room.id).emit("newRoundStarted", {
      activePlayers,
      firstCard: first,
      currentPlayer: this.gameState.currentPlayer,
    });

    // Enviar estado público actualizado inmediatamente
    this.broadcastPublicState();
  }

  advanceTurnAfterPlay(card, effects) {
    // NO limpiar desafío si se acaba de jugar un wild_draw4
    if (
      this.wild4Challenge &&
      !this.wild4Challenge.resolved &&
      card.kind !== "wild_draw4"
    ) {
      this.wild4Challenge.resolved = true;
    }

    // Reglas de salto, reverse ya se aplicó en effects
    if (card.kind === "skip") {
      if (this.gameState.players.length === 2) {
        // En 1vs1, skip hace que el mismo jugador siga jugando
        // No avanzar turno, mantener el jugador actual
        return;
      } else {
        // En 3+ jugadores, skip salta al siguiente
        this.turnManager.skipNext();
        this.turnManager.nextTurn();
      }
    } else if (card.kind === "reverse") {
      if (this.gameState.players.length === 2) {
        // En 1vs1, reverse actúa como skip - mismo jugador sigue
        return;
      } else {
        // ya se cambió direction en applyCardEffects, solo avanzar turno
        this.turnManager.nextTurn();
      }
    } else if (card.kind === "draw2" || card.kind === "wild_draw4") {
      // stacking manejado en estado; siguiente jugador deberá responder o robar
      this.turnManager.nextTurn();
      // No auto-skip; la lógica de stacking se resuelve cuando el siguiente decide jugar o robar
    } else {
      // Carta normal, solo avanzar turno
      this.turnManager.nextTurn();
    }
  }

  drawCard(socketId) {
    console.log("[UNO][UnoGameHandler.drawCard] start", {
      socketId,
      currentPlayer: this.gameState.currentPlayer,
      pending: this.gameState.pendingDrawCount,
    });
    if (!this.gameState.started || this.gameState.gameEnded)
      return { ok: false, reason: "not_started" };
    if (this.gameState.currentPlayer !== socketId)
      return { ok: false, reason: "not_your_turn" };

    const hand = this.gameState.hands[socketId];
    if (!hand) return { ok: false, reason: "hand_not_found" };

    if (this.gameState.pendingDrawCount > 0) {
      // Debe robar todas las cartas acumuladas y pierde turno
      const toDraw = this.gameState.pendingDrawCount;
      for (let i = 0; i < toDraw; i++) {
        drawOne(this.gameState, socketId);
      }
      this.io.to(socketId).emit("privateHand", { hand });
      this.io.to(this.room.id).emit("playerDrew", {
        playerId: socketId,
        count: toDraw,
        stacked: true,
      });

      // Si es el target player del desafío, resolver automáticamente
      if (
        this.wild4Challenge &&
        !this.wild4Challenge.resolved &&
        this.wild4Challenge.targetPlayer === socketId
      ) {
        this.wild4Challenge.resolved = true;
      }

      // Reset stacking
      this.gameState.pendingDrawCount = 0;
      this.gameState.pendingDrawType = null;
      // Avanzar turno después de pagar
      this.turnManager.nextTurn();

      // Enviar estado público actualizado
      this.broadcastPublicState();

      console.log("[UNO][UnoGameHandler.drawCard] stacked draw complete", {
        socketId,
        drew: toDraw,
      });
      return { ok: true, drew: toDraw, stacked: true };
    }

    // Robo normal de 1
    const card = drawOne(this.gameState, socketId);
    this.io.to(socketId).emit("privateHand", { hand });

    // Si ahora tiene >1 cartas eliminar estado UNO si existía
    this.clearUnoStateIfNeeded(socketId);

    // Reglas UNO: si la carta robada es jugable podría permitir jugar inmediatamente (no implementado, se puede agregar)

    // Avanzar turno al siguiente
    this.turnManager.nextTurn();

    // Enviar estado público actualizado
    this.broadcastPublicState();

    console.log("[UNO][UnoGameHandler.drawCard] normal draw complete", {
      socketId,
      drew: 1,
    });
    return { ok: true, drew: 1 };
  }

  // ---- Challenge Wild Draw 4 ----
  challengeWild4(socketId) {
    const ch = this.wild4Challenge;
    if (!ch || ch.resolved) return { ok: false, reason: "no_active_challenge" };
    if (!ch.eligibleChallengers.includes(socketId))
      return { ok: false, reason: "not_eligible_challenger" };

    // Evaluar si el jugador que jugó el +4 tenía otra jugada legal antes de jugarlo.
    const previousColor =
      ch.previousColor ||
      (ch.previousTopCard && ch.previousTopCard.color) ||
      null;
    const topBefore = ch.previousTopCard;
    let hadPlayable = false;
    for (const c of ch.snapshotHand) {
      if (c.kind === "wild") {
        hadPlayable = true;
        break;
      }
      if (previousColor && c.color === previousColor) {
        hadPlayable = true;
        break;
      }
      if (topBefore) {
        if (
          topBefore.kind === "number" &&
          c.kind === "number" &&
          c.value === topBefore.value
        ) {
          hadPlayable = true;
          break;
        }
        if (topBefore.kind !== "number" && c.kind === topBefore.kind) {
          hadPlayable = true;
          break;
        }
      }
    }

    let result;
    if (hadPlayable) {
      // El desafiante gana: quien jugó +4 toma 4 cartas
      for (let i = 0; i < 4; i++) drawOne(this.gameState, ch.playedBy);
      this.io.to(ch.playedBy).emit("privateHand", {
        hand: this.gameState.hands[ch.playedBy],
      });
      // Limpiar acumulación para el target player
      this.gameState.pendingDrawCount = 0;
      this.gameState.pendingDrawType = null;
      result = {
        ok: true,
        success: true,
        penalized: ch.playedBy,
        penalty: 4,
        challenger: socketId,
        target: ch.playedBy, // Quien jugó el +4 original
        wasValid: false, // El +4 NO era válido (sí podía jugar otra carta)
      };
    } else {
      // El desafiante pierde: toma las cartas acumuladas (4 + lo que hubiera)
      const penalty = Math.max(4, this.gameState.pendingDrawCount || 4);
      for (let i = 0; i < penalty; i++) drawOne(this.gameState, socketId);
      this.io.to(socketId).emit("privateHand", {
        hand: this.gameState.hands[socketId],
      });
      // Si el desafiante era el target player, avanzar turno
      if (socketId === ch.targetPlayer) {
        this.gameState.pendingDrawCount = 0;
        this.gameState.pendingDrawType = null;
        this.turnManager.nextTurn();
      }
      result = {
        ok: true,
        success: false,
        penalized: socketId,
        penalty: penalty,
        challenger: socketId,
        target: ch.playedBy, // Quien jugó el +4 original
        wasValid: true, // El +4 SÍ era válido (no podía jugar otra carta)
      };
    }

    ch.resolved = true;
    this.io.to(this.room.id).emit("wild4ChallengeResult", result);
    return result;
  }

  acceptWild4(socketId) {
    const ch = this.wild4Challenge;
    if (!ch || ch.resolved) return { ok: false, reason: "no_active_challenge" };
    if (socketId !== ch.targetPlayer)
      return { ok: false, reason: "not_target_player" };
    // Pagar cartas acumuladas (si no respondió con otro draw4 antes) - ya se maneja en drawCard.
    ch.resolved = true;
    return { ok: true, accepted: true };
  }

  // ---- Lógica UNO (decir y acusar) ----
  updateUnoStateFor(playerId) {
    const hand = this.gameState.hands[playerId] || [];
    if (hand.length === 1) {
      const info = this.unoState.players.get(playerId) || {};
      if (!info.atOneSince) {
        info.atOneSince = Date.now();
        info.declared = false;
        info.penalized = false;
        this.unoState.players.set(playerId, info);
        this.io.to(this.room.id).emit("playerAtUno", {
          playerId,
          graceMs: this.unoState.graceMs,
        });

        // Configurar timer para abrir ventana de reclamo después del período de gracia
        const timerId = setTimeout(() => {
          // Verificar que el jugador sigue con 1 carta y no ha declarado UNO
          const currentHand = this.gameState.hands[playerId] || [];
          const currentInfo = this.unoState.players.get(playerId);

          if (
            currentHand.length === 1 &&
            currentInfo &&
            !currentInfo.declared &&
            !currentInfo.penalized
          ) {
            // Obtener nombre del jugador
            const player = this.room.players.get(playerId);
            const playerName = player?.name || player?.username || "Jugador";

            // Abrir ventana de reclamo
            this.io.to(this.room.id).emit("unoClaimWindowOpen", {
              playerId,
              playerName,
              gracePeriodMs: this.unoState.graceMs,
            });

            console.log(
              `[UNO] Claim window opened for player ${playerName} (${playerId})`
            );
          }

          // Limpiar el timer
          this.unoClaimTimers.delete(playerId);
        }, this.unoState.graceMs);

        // Guardar el timer para poder cancelarlo si es necesario
        this.unoClaimTimers.set(playerId, timerId);
      }
    } else {
      // Más de una carta -> limpiar
      this.clearUnoStateIfNeeded(playerId);
    }
  }

  clearUnoStateIfNeeded(playerId) {
    const hand = this.gameState.hands[playerId] || [];
    if (hand.length !== 1) {
      if (this.unoState.players.has(playerId)) {
        // Cancelar timer de ventana de reclamo si existe
        const timerId = this.unoClaimTimers.get(playerId);
        if (timerId) {
          clearTimeout(timerId);
          this.unoClaimTimers.delete(playerId);
        }

        this.unoState.players.delete(playerId);
        this.io.to(this.room.id).emit("unoStateCleared", { playerId });

        // Cerrar ventana de reclamo si estaba abierta
        this.io.to(this.room.id).emit("unoClaimWindowClosed", {
          playerId,
          reason: "more_cards",
        });
      }
    }
  }

  declareUno(socketId) {
    const info = this.unoState.players.get(socketId);
    if (!info) return { ok: false, reason: "not_at_uno" };
    if (info.declared) return { ok: false, reason: "already_declared" };

    info.declared = true;

    // Cancelar timer de ventana de reclamo si existe
    const timerId = this.unoClaimTimers.get(socketId);
    if (timerId) {
      clearTimeout(timerId);
      this.unoClaimTimers.delete(socketId);
    }

    this.io.to(this.room.id).emit("unoDeclared", { playerId: socketId });

    // Cerrar ventana de reclamo
    this.io.to(this.room.id).emit("unoClaimWindowClosed", {
      playerId: socketId,
      reason: "declared",
    });

    return { ok: true };
  }

  callOutUno(socketId, targetPlayerId) {
    if (socketId === targetPlayerId) {
      return { ok: false, reason: "cannot_call_self" };
    }
    const info = this.unoState.players.get(targetPlayerId);
    if (!info) return { ok: false, reason: "target_not_at_uno" };
    if (info.declared) return { ok: false, reason: "already_declared" };
    if (info.penalized) return { ok: false, reason: "already_penalized" };

    const elapsed = Date.now() - (info.atOneSince || 0);
    if (elapsed < this.unoState.graceMs) {
      return { ok: false, reason: "grace_period" };
    }

    // Cancelar timer de ventana de reclamo si existe
    const timerId = this.unoClaimTimers.get(targetPlayerId);
    if (timerId) {
      clearTimeout(timerId);
      this.unoClaimTimers.delete(targetPlayerId);
    }

    // Penalizar +2 cartas
    for (let i = 0; i < 2; i++) {
      drawOne(this.gameState, targetPlayerId);
    }
    info.penalized = true;
    this.io.to(targetPlayerId).emit("privateHand", {
      hand: this.gameState.hands[targetPlayerId],
    });

    // Limpiar estado UNO (ya no está a una carta)
    this.clearUnoStateIfNeeded(targetPlayerId);

    this.io.to(this.room.id).emit("unoCalledOut", {
      target: targetPlayerId,
      by: socketId,
      penalty: 2,
    });

    // Cerrar ventana de reclamo
    this.io.to(this.room.id).emit("unoClaimWindowClosed", {
      playerId: targetPlayerId,
      reason: "claimed",
    });

    return { ok: true, penalty: 2 };
  }

  // Public state consolidado con información de UNO y challenge
  getPublicState() {
    const top = topDiscard(this.gameState);
    const unoPlayers = [];
    for (const [pid, info] of this.unoState.players.entries()) {
      const hand = this.gameState.hands[pid] || [];
      if (hand.length === 1) {
        unoPlayers.push({
          playerId: pid,
          declared: !!info.declared,
          graceRemainingMs: info.declared
            ? 0
            : Math.max(
                0,
                this.unoState.graceMs - (Date.now() - (info.atOneSince || 0))
              ),
        });
      }
    }

    // IMPORTANT: Preservar datos de jugadores del lobby para evitar parpadeo
    // En lugar de no enviar players cuando no ha empezado, enviar los datos completos
    // mezclando la información del lobby con el estado del juego
    let playersSection = {};

    if (this.gameState.started) {
      // Juego iniciado: usar gameState.players con datos del lobby
      playersSection.players = this.gameState.players.map((pid) => {
        const roomPlayer = this.room.players.get(pid) || {};
        return {
          id: pid,
          handCount: (this.gameState.hands[pid] || []).length,
          name: roomPlayer.name,
          username: roomPlayer.username,
          avatarId: roomPlayer.avatarId, // Solo avatarId, no avatarUrl
          totalPoints: this.gameState.scores
            ? this.gameState.scores[pid] || 0
            : 0,
        };
      });

      // Debug: solo loggear cuando hay cambios significativos, no en cada estado
      if (playersSection.players.some((p) => p.handCount === 1)) {
        console.log(`[UNO] Game state update - players with 1 card detected`);
      }
    } else {
      // Juego no iniciado: enviar datos del lobby para mantener consistencia
      const lobbyPlayers = Array.from(this.room.players.entries()).map(
        ([sid, p]) => ({
          id: sid,
          name: p.name,
          username: p.username,
          avatarId: p.avatarId, // Solo avatarId, no avatarUrl
          handCount: 0, // Sin cartas antes de empezar
          totalPoints: this.gameState.scores
            ? this.gameState.scores[sid] || 0
            : 0,
        })
      );
      playersSection.players = lobbyPlayers;

      // Debug: solo loggear al inicio del juego, no constantemente
      if (lobbyPlayers.length > 0) {
        console.log(`[UNO] Lobby state - ${lobbyPlayers.length} players ready`);
      }
    }

    return {
      started: this.gameState.started,
      gameEnded: this.gameState.gameEnded,
      currentPlayer: this.gameState.currentPlayer,
      direction: this.gameState.direction,
      currentColor: this.gameState.currentColor,
      topCard: top
        ? { id: top.id, color: top.color, kind: top.kind, value: top.value }
        : null,
      discardCount: this.gameState.discardPile.length,
      drawCount: this.gameState.drawPile.length,
      pendingDrawCount: this.gameState.pendingDrawCount,
      pendingDrawType: this.gameState.pendingDrawType,
      winner: this.gameState.winner,
      uno: unoPlayers,
      wild4Challenge:
        this.wild4Challenge && !this.wild4Challenge.resolved
          ? {
              playedBy: this.wild4Challenge.playedBy,
              targetPlayer: this.wild4Challenge.targetPlayer,
              eligibleChallengers: this.wild4Challenge.eligibleChallengers,
              deadline: this.wild4Challenge.timeoutAt,
            }
          : null,
      scores: this.gameState.scores,
      eliminatedPlayers: Array.from(this.gameState.eliminatedPlayers || []),
      roundWinner: this.gameState.roundWinner,
      ...playersSection,
    };
  }

  // Método para enviar el estado público a todos los clientes
  broadcastPublicState() {
    const publicState = this.getPublicState();
    this.io.to(this.room.id).emit("state", publicState);
  }

  // Guardar estadísticas del juego
  async saveGameStats(winnerId) {
    try {
      console.log(
        `[UNO] Saving game stats for room ${this.room.id}, winner: ${winnerId}`
      );

      // Preparar datos de jugadores para las estadísticas
      const playerResults = {};

      this.gameState.players.forEach((playerId) => {
        const player = this.room.players.get(playerId);
        if (player) {
          const username = player.username || player.name;
          if (username) {
            // En UNO no hay "figuras" como en BINGO, solo registramos participación
            playerResults[username] = []; // Array vacío, solo registramos participación
          }
        }
      });

      // Obtener el username del ganador
      let winnerUsername = null;
      if (winnerId) {
        const winnerPlayer = this.room.players.get(winnerId);
        if (winnerPlayer) {
          winnerUsername = winnerPlayer.username || winnerPlayer.name;
        }
      }

      // Registrar resultado del juego
      await statsService.recordGameResult({
        gameKey: "uno",
        roomId: this.room.id,
        winnerId: winnerUsername,
        playersWithFigures: playerResults,
      });

      console.log(`[UNO] Game stats saved successfully`);
    } catch (error) {
      console.error(`[UNO] Error saving game stats:`, error);
    }
  }

  // Método debug para hacer ganar a un jugador rápidamente
  async debugWinPlayer(socketId, targetPlayerId) {
    // Solo permitir en desarrollo o con una flag especial
    if (process.env.NODE_ENV === "production") {
      return { ok: false, reason: "debug_disabled_in_production" };
    }

    if (!this.gameState.started || this.gameState.gameEnded) {
      return { ok: false, reason: "game_not_active" };
    }

    // Verificar que el jugador objetivo existe y está en la partida
    if (!this.gameState.players.includes(targetPlayerId)) {
      return { ok: false, reason: "player_not_in_game" };
    }

    console.log(
      `[UNO][DEBUG] ${socketId} is making ${targetPlayerId} win instantly`
    );

    // Vaciar la mano del jugador objetivo (dejarlo con 0 cartas)
    this.gameState.hands[targetPlayerId] = [];

    // Establecer al jugador como ganador de la ronda
    this.gameState.roundWinner = targetPlayerId;

    // Verificar si estamos en modo de puntos
    const pointsToWin = this.room.config.pointsToWin;

    if (pointsToWin) {
      // Modo de puntos - manejar como fin de ronda
      this.broadcastPublicState();
      await this.handleRoundEnd(targetPlayerId);
    } else {
      // Modo clásico - terminar juego inmediatamente
      this.gameState.gameEnded = true;
      this.gameState.winner = targetPlayerId;
      this.room.gameEnded = true;
      this.broadcastPublicState();
      this.io.to(this.room.id).emit("winner", { playerId: targetPlayerId });
    }

    return { ok: true, winner: targetPlayerId };
  }
}

module.exports = UnoGameHandler;
