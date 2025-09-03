const BaseGameHandler = require("../BaseGameHandler");
const TurnManager = require("../../shared/TurnManager");
const {
  createDeck,
  shuffleDeck,
  dealCards,
  createInitialGameState,
  compareCards,
  calculateEnvido,
  hasFlor,
  getPlayerTeam,
} = require("./logic");

class TrucoGameHandlerWithTurnManager extends BaseGameHandler {
  constructor(room, io) {
    // Configurar el room ANTES de inicializar el estado base
    room.config = room.config || {};
    room.config.playerCount = 2;
    room.config.maxPlayers = 2;

    super(room);
    this.io = io;

    // Crear TurnManager con callbacks
    this.turnManager = new TurnManager({
      maxSkips: 1,
      onTurnChange: (turnInfo) => {
        console.log(
          `🎯 [TurnManager] Cambio de turno: ${turnInfo.previousPlayer} -> ${turnInfo.currentPlayer} (Equipo: ${turnInfo.team})`
        );

        // Actualizar el estado del juego
        this.gameState.currentPlayerSocketId = turnInfo.currentPlayer;

        // Notificar a los clientes
        // Construir acciones disponibles para el jugador actual
        const actions = this.buildAvailableActions(turnInfo.currentPlayer);

        this.io.to(this.room.id).emit("turnChanged", {
          previousPlayer: turnInfo.previousPlayer,
          currentPlayer: turnInfo.currentPlayer,
          team: turnInfo.team,
          direction: turnInfo.direction,
          availableActions: actions,
        });

        // Además, enviar acciones por jugador (gating por palabra/turno)
        const ids = this.getPlayerSocketIds();
        ids.forEach((id) => this.sendAvailableActionsTo(id));
      },
      onDirectionChange: (direction) => {
        console.log(
          `🔄 [TurnManager] Dirección cambiada: ${
            direction === 1 ? "Horario" : "Antihorario"
          }`
        );

        this.io.to(this.room.id).emit("directionChanged", {
          direction: direction === 1 ? "clockwise" : "counterclockwise",
        });
      },
      onPlayerSkipped: (skippedPlayer, nextPlayer) => {
        console.log(
          `⏭️ [TurnManager] Jugador ${skippedPlayer} saltado, turno pasa a ${nextPlayer}`
        );

        this.io.to(this.room.id).emit("playerSkipped", {
          skippedPlayer,
          nextPlayer,
        });
      },
    });
  }

  // Envía acciones disponibles calculadas para un socket específico
  sendAvailableActionsTo(socketId) {
    if (!socketId) return;
    const actions = this.buildAvailableActions(socketId);
    this.io.to(socketId).emit("availableActionsUpdate", {
      availableActions: actions,
      currentPlayer: this.gameState.currentPlayerSocketId,
    });
  }
  // Construye las acciones disponibles para un jugador dado su socketId
  buildAvailableActions(currentSocketId) {
    const actions = [];
    // Sólo puedes jugar carta en tu turno
    if (this.turnManager.isPlayerTurn(currentSocketId)) {
      actions.push("play_card");
    }
    const isFirstTurn = this.gameState.gamePhase === "first_turn";
    const florDeclared = !!(
      this.gameState.florState?.declarations &&
      this.gameState.florState.declarations.size > 0
    );

    // Envido: manejo de inicio y respuesta en primer turno si no hay flor resuelta
    if (isFirstTurn && !florDeclared) {
      const idx = this.getPlayerIndex(currentSocketId);
      const hand = this.gameState.playerHands?.[idx] || [];
      const florInfoSelf = hasFlor(hand, this.gameState.muestra);
      if (!this.gameState.envidoState.active) {
        // Iniciar envido solo en tu turno y solo si NO tenés flor sin declarar
        if (
          this.turnManager.isPlayerTurn(currentSocketId) &&
          !(
            florInfoSelf?.hasFlor &&
            !this.gameState.florState?.declarations?.has?.(idx)
          )
        ) {
          actions.push("envido", "real_envido", "falta_envido");
        }
      } else {
        // Envido activo: solo el respondedor (no el último que cantó) puede responder y/o subir
        const lastDeclarer = this.gameState.envidoState.declarer;
        if (idx !== lastDeclarer) {
          // Si el respondedor tiene FLOR sin declarar, ocultar todas las opciones de ENVIDO y permitir solo FLOR
          const alreadyDeclaredFlor =
            this.gameState.florState?.declarations?.has?.(idx);
          if (florInfoSelf?.hasFlor && !alreadyDeclaredFlor) {
            actions.push("flor");
          } else {
            actions.push(
              "accept_envido",
              "reject_envido",
              "envido",
              "real_envido",
              "falta_envido"
            );
          }
        }
      }
    }

    // Flor: solo si el jugador tiene flor y aún no la declaró; solo en primer turno
    if (isFirstTurn) {
      const idx = this.getPlayerIndex(currentSocketId);
      const hand = this.gameState.playerHands?.[idx] || [];
      const florInfo = hasFlor(hand, this.gameState.muestra);
      const alreadyDeclared =
        this.gameState.florState?.declarations?.has?.(idx);
      if (florInfo?.hasFlor && !alreadyDeclared) {
        if (this.gameState.envidoState?.active) {
          // Envido activo: solo el respondedor puede cantar FLOR
          const lastDeclarer = this.gameState.envidoState.declarer;
          if (idx !== lastDeclarer) {
            actions.push("flor");
          }
        } else if (this.turnManager.isPlayerTurn(currentSocketId)) {
          // Sin envido activo: solo en tu turno podés cantar FLOR
          actions.push("flor");
        }
      }
      // Si ya hay una flor declarada y yo también tengo flor sin declarar, permitir contraflor (solo si es tu turno)
      if (florDeclared && florInfo?.hasFlor && !alreadyDeclared) {
        if (this.turnManager.isPlayerTurn(currentSocketId)) {
          actions.push("contraflor");
        }
      }
    }

    // Truco: durante la fase de juego
    if (this.gameState.gamePhase === "playing") {
      const truco = this.gameState.trucoState || {};
      const idx = this.getPlayerIndex(currentSocketId);
      const myTeam = this.resolveTeamFrom(currentSocketId, idx);

      if (truco.level > 0) {
        // Hay truco cantado
        if (truco.pendingResponse && truco.declarerTeam !== undefined) {
          const responderTeam = truco.declarerTeam === 0 ? 1 : 0;
          if (myTeam === responderTeam) {
            actions.push("accept_truco", "reject_truco", "truco"); // "truco" aquí actúa como subir (re-truco/vale4)
          }
        } else if (truco.accepted && truco.teamWithWord !== undefined) {
          // Con truco aceptado, solo el equipo con la palabra puede subir
          if (myTeam === truco.teamWithWord) {
            actions.push("truco");
          }
        }
      } else {
        // Sin truco aún: permitir iniciar solo en tu turno
        if (this.turnManager.isPlayerTurn(currentSocketId)) {
          actions.push("truco");
        }
      }
    }

    return actions;
  }

  // Declaración manual de Flor por el jugador actual
  declareFlor(socketId) {
    const playerIndex = this.getPlayerIndex(socketId);
    if (playerIndex < 0) return { ok: false, reason: "player_not_found" };

    // Solo se puede declarar en el primer turno
    if (this.gameState.gamePhase !== "first_turn") {
      return { ok: false, reason: "flor_only_first_turn" };
    }

    // Reglas de "la palabra":
    // - Si hay envido activo, solo el respondedor (no el último que cantó) puede responder con FLOR
    // - Si no hay envido activo, solo en tu turno podés declarar FLOR
    if (this.gameState.envidoState?.active) {
      const lastDeclarer = this.gameState.envidoState.declarer;
      if (playerIndex === lastDeclarer) {
        return { ok: false, reason: "not_responder_for_flor" };
      }
    } else {
      if (!this.turnManager.isPlayerTurn(socketId)) {
        return { ok: false, reason: "not_your_turn" };
      }
    }

    // Validar que tenga Flor
    const hand = this.gameState.playerHands?.[playerIndex] || [];
    const florInfo = hasFlor(hand, this.gameState.muestra);
    if (!florInfo?.hasFlor) {
      return { ok: false, reason: "no_flor" };
    }

    // Si había un envido activo, se cancela por la flor
    if (this.gameState.envidoState?.active) {
      this.gameState.envidoState.active = false;
      this.gameState.envidoState.type = null;
      this.gameState.envidoState.declarer = null;
      this.io.to(this.room.id).emit("envidoCanceled", {
        reason: "flor_declared",
        by: playerIndex,
      });
    }

    // Calcular equipo y sumar puntos
    const team = this.resolveTeamFrom(socketId, playerIndex);
    const florPoints = 3; // simplificado
    this.gameState.scores[team] += florPoints;

    // Registrar declaración
    if (!this.gameState.florState.declarations) {
      this.gameState.florState.declarations = new Map();
    }
    this.gameState.florState.declarations.set(playerIndex, {
      type: florInfo.type,
      suit: florInfo.suit,
      points: florPoints,
      automatic: false,
    });

    // Emitir evento
    this.io.to(this.room.id).emit("florDeclared", {
      playerId: playerIndex,
      florInfo,
      points: florPoints,
      team,
      automatic: false,
      gameState: this.getPublicState(),
    });

    // Refrescar acciones disponibles para el jugador actual
    const cp = this.gameState.currentPlayerSocketId;
    if (cp) {
      this.io.to(this.room.id).emit("turnChanged", {
        previousPlayer: null,
        currentPlayer: cp,
        team: this.turnManager.getPlayerTeam(cp),
        direction: this.turnManager.getState().direction,
        availableActions: this.buildAvailableActions(cp),
      });
      // También refrescar acciones por jugador (2 jugadores)
      const ids = this.getPlayerSocketIds();
      ids.forEach((id) => this.sendAvailableActionsTo(id));
    }

    // Chequear fin de juego
    if (this.gameState.scores[team] >= 30) {
      setTimeout(() => this.endGame(team), 500);
    }

    return { ok: true };
  }

  // Declaración de contraFlor si ya hay flor declarada y este jugador también tiene flor
  declareContraFlor(socketId) {
    const playerIndex = this.getPlayerIndex(socketId);
    if (playerIndex < 0) return { ok: false, reason: "player_not_found" };

    // Solo se puede declarar en el primer turno
    if (this.gameState.gamePhase !== "first_turn") {
      return { ok: false, reason: "contraflor_only_first_turn" };
    }

    // Debe existir al menos una flor declarada previamente
    const hasAnyFlor =
      this.gameState.florState?.declarations &&
      this.gameState.florState.declarations.size > 0;
    if (!hasAnyFlor) {
      return { ok: false, reason: "no_flor_to_contraflor" };
    }

    // Validar que este jugador tenga Flor
    const hand = this.gameState.playerHands?.[playerIndex] || [];
    const florInfo = hasFlor(hand, this.gameState.muestra);
    if (!florInfo?.hasFlor) {
      return { ok: false, reason: "no_flor" };
    }

    if (!this.gameState.florState.declarations) {
      this.gameState.florState.declarations = new Map();
    }
    this.gameState.florState.declarations.set(playerIndex, {
      type: florInfo.type,
      suit: florInfo.suit,
      points: 0,
      automatic: false,
      response: "contraflor",
    });

    this.io.to(this.room.id).emit("contraflorDeclared", {
      playerId: playerIndex,
      florInfo,
      gameState: this.getPublicState(),
    });

    // Refrescar acciones disponibles
    const cp = this.gameState.currentPlayerSocketId;
    if (cp) {
      this.io.to(this.room.id).emit("turnChanged", {
        previousPlayer: null,
        currentPlayer: cp,
        team: this.turnManager.getPlayerTeam(cp),
        direction: this.turnManager.getState().direction,
        availableActions: this.buildAvailableActions(cp),
      });
    }

    return { ok: true };
  }

  createInitialState() {
    // Fallback seguro por si la config aún no estuviera presente
    const playerCount = this.room.config.playerCount || 2;
    const initialState = createInitialGameState(playerCount);

    // Remover las propiedades index-based
    delete initialState.currentPlayer;
    delete initialState.currentDealer;

    return {
      ...initialState,
      started: false,
      gameEnded: false,
      currentPlayerSocketId: null,
      currentDealerSocketId: null,
    };
  }

  getPublicState() {
    // El TurnManager maneja la validación del currentPlayerSocketId
    const currentPlayer = this.turnManager.getCurrentPlayer();
    if (currentPlayer) {
      this.gameState.currentPlayerSocketId = currentPlayer;
    }

    const publicState = {
      started: this.gameState.started,
      gameEnded: this.gameState.gameEnded,
      teams: this.gameState.teams,
      teamCount: this.gameState.teamCount,
      playerCount: this.gameState.players,
      currentPlayerSocketId: this.gameState.currentPlayerSocketId,
      currentDealerSocketId: this.gameState.currentDealerSocketId,
      round: this.gameState.round,
      hand: this.gameState.hand,
      muestra: this.gameState.muestra,
      playedCards: this.gameState.playedCards,
      roundWinners: this.gameState.roundWinners,
      scores: this.gameState.scores,
      gamePhase: this.gameState.gamePhase,
      trucoState: this.gameState.trucoState,
      envidoState: {
        active: this.gameState.envidoState.active,
        type: this.gameState.envidoState.type,
        declarer: this.gameState.envidoState.declarer,
      },
      florState: {
        active: this.gameState.florState.active,
        declarations: this.gameState.florState.declarations
          ? Object.fromEntries(this.gameState.florState.declarations)
          : {},
      },
      // Información adicional del TurnManager
      turnInfo: this.turnManager.getState(),
    };

    console.log(
      `🎯 [Backend] getPublicState - currentPlayerSocketId: ${publicState.currentPlayerSocketId}, gamePhase: ${publicState.gamePhase}`
    );

    return publicState;
  }

  getGameConfig() {
    return {
      playerCount: 2,
      maxPlayers: 2,
      gameType: "truco",
      description: "Truco Uruguayo - 1 vs 1",
    };
  }

  setGameConfig(newConfig) {
    if (newConfig.playerCount !== undefined && newConfig.playerCount !== 2) {
      console.log("Intento de cambiar playerCount en Truco - rechazado");
      return false;
    }
    return true;
  }

  // ========== MÉTODOS SIMPLIFICADOS CON TURNMANAGER ==========

  getPlayerSocketIds() {
    return this.turnManager.players;
  }

  getPlayerTeamBySocketId(socketId) {
    return this.resolveTeamFrom(socketId);
  }

  // Resuelve el equipo de un jugador con fallback robusto
  resolveTeamFrom(socketId, playerIndex = null) {
    let team = this.turnManager.getPlayerTeam(socketId);
    if (team === null || team === undefined) {
      const idx =
        typeof playerIndex === "number" && playerIndex >= 0
          ? playerIndex
          : this.getPlayerIndex(socketId);
      try {
        team = getPlayerTeam(idx, this.gameState.teams);
      } catch (e) {
        // Fallback final para modo 1v1
        team = idx % 2;
      }
    }
    return team;
  }

  isPlayerTurn(socketId) {
    return this.turnManager.isPlayerTurn(socketId);
  }

  nextTurn(options = {}) {
    return this.turnManager.nextTurn(options);
  }

  startGame() {
    console.log(`🔥 [NUEVO LOG] startGame ejecutado - VERSION ACTUALIZADA`);

    if (this.room.players.size !== 2) {
      console.log(
        `No se puede iniciar Truco: ${this.room.players.size} jugadores (se necesitan 2)`
      );
      return false;
    }

    this.gameState.started = true;
    this.gameState.gameEnded = false;
    this.room.playersReady.clear();

    const playerIds = Array.from(this.room.players.keys());
    console.log(
      `🎯 [Backend] Iniciando juego con jugadores: ${playerIds.join(", ")}`
    );

    // Inicializar TurnManager (cada jugador es su propio equipo en Truco)
    this.turnManager.initialize(playerIds);

    // Establecer dealer y jugador inicial
    this.gameState.currentDealerSocketId = playerIds[0];
    this.turnManager.setCurrentPlayer(playerIds[1]); // El segundo jugador empieza
    this.gameState.currentPlayerSocketId = this.turnManager.getCurrentPlayer();

    console.log(
      `🎯 [Backend] Dealer: ${this.gameState.currentDealerSocketId}, Jugador inicial: ${this.gameState.currentPlayerSocketId}`
    );

    // Inicializar mano si aún no existe
    if (!this.gameState.hand || this.gameState.hand < 1) {
      this.gameState.hand = 1;
    }
    this.dealNewHand();
    this.gameState.gamePhase = "first_turn";

    this.io.to(this.room.id).emit("gameStarted", {
      gameState: this.getPublicState(),
      turnManager: this.turnManager.getState(),
    });

    this.sendPrivateHands();

    console.log(
      `Partida de Truco iniciada en sala ${this.room.id} con TurnManager`
    );
    return true;
  }

  dealNewHand() {
    const deck = shuffleDeck(createDeck());
    const playerIds = this.getPlayerSocketIds();
    console.log(`🎯 [Backend] dealNewHand - playerIds:`, playerIds);

    const { hands, muestra } = dealCards(deck, playerIds.length);
    console.log(`🎯 [Backend] dealNewHand - cartas repartidas:`, hands);
    console.log(`🎯 [Backend] dealNewHand - muestra:`, muestra);

    this.gameState.deck = deck;
    this.gameState.muestra = muestra;
    this.gameState.playerHands = hands;
    this.gameState.playedCards = [];
    this.gameState.roundWinners = [];
    this.gameState.round = 1;

    // Si es una nueva mano, cambiar el dealer
    if (this.gameState.hand > 1) {
      const currentPlayerIds = this.getPlayerSocketIds();
      const currentDealerIndex = currentPlayerIds.indexOf(
        this.gameState.currentDealerSocketId
      );
      const nextDealerIndex =
        (currentDealerIndex + 1) % currentPlayerIds.length;
      this.gameState.currentDealerSocketId = currentPlayerIds[nextDealerIndex];
    }

    // El jugador que empieza es el siguiente al dealer
    const allPlayerIds = this.getPlayerSocketIds();
    const dealerIndex = allPlayerIds.indexOf(
      this.gameState.currentDealerSocketId
    );
    const startPlayerIndex = (dealerIndex + 1) % allPlayerIds.length;
    this.turnManager.setCurrentPlayer(allPlayerIds[startPlayerIndex]);
    this.gameState.currentPlayerSocketId = this.turnManager.getCurrentPlayer();

    console.log(
      `🎯 [Backend] dealNewHand - Dealer: ${this.gameState.currentDealerSocketId}, Jugador actual: ${this.gameState.currentPlayerSocketId}`
    );

    // Resetear estados de cantos
    this.gameState.trucoState = {
      level: 0,
      declarer: null,
      accepted: false,
    };

    this.gameState.envidoState = {
      active: false,
      type: null,
      declarer: null,
      responses: new Map(),
    };

    this.gameState.florState = {
      active: false,
      declarations: new Map(),
    };

    console.log(
      `Nueva mano - Dealer: ${this.gameState.currentDealerSocketId}, Muestra: ${muestra.id}`
    );
  }

  playCard(socketId, cardId) {
    // Usar TurnManager para validar turno
    if (!this.gameState.started || this.gameState.gameEnded) {
      return { ok: false, reason: "game_not_active" };
    }

    if (!this.turnManager.isPlayerTurn(socketId)) {
      return { ok: false, reason: "not_your_turn" };
    }

    const playerIndex = this.getPlayerIndex(socketId);
    if (playerIndex === -1) {
      return { ok: false, reason: "player_not_found" };
    }

    const playerHand = this.gameState.playerHands[playerIndex];
    const cardIndex = playerHand.findIndex((card) => card.id === cardId);

    if (cardIndex === -1) {
      return { ok: false, reason: "card_not_found" };
    }

    // Jugar la carta
    const playedCard = playerHand.splice(cardIndex, 1)[0];
    this.gameState.playedCards.push({
      playerSocketId: socketId,
      playerId: playerIndex,
      card: playedCard,
    });

    const playerData = this.room.players.get(socketId);
    const playerName = playerData?.name || `Jugador ${playerIndex}`;
    console.log(
      `🃏 [Backend] Carta jugada: ${playedCard.id} por ${playerName} (${socketId})`
    );

    // Avanzar turno usando TurnManager
    const turnInfo = this.turnManager.nextTurn();

    // Si es el primer turno, cambiar a fase de juego normal
    if (this.gameState.gamePhase === "first_turn") {
      this.gameState.gamePhase = "playing";
      console.log(
        `🎯 [Backend] Primera carta jugada - cambiando a fase 'playing'`
      );
    }

    // Verificar si todos jugaron en esta ronda (según manos vivas)
    const activePlayers = Array.isArray(this.gameState.playerHands)
      ? this.gameState.playerHands.length
      : this.room?.config?.playerCount || 2;
    if (this.gameState.playedCards.length === activePlayers) {
      this.resolveRound();
    }

    this.io.to(this.room.id).emit("cardPlayed", {
      playerId: playerIndex,
      playerSocketId: socketId,
      card: playedCard,
      gameState: this.getPublicState(),
      turnInfo: turnInfo,
    });

    return { ok: true };
  }

  resolveRound() {
    let winnerIndex = 0;
    let bestCard = this.gameState.playedCards[0];

    for (let i = 1; i < this.gameState.playedCards.length; i++) {
      const comparison = compareCards(
        this.gameState.playedCards[i].card,
        bestCard.card,
        this.gameState.muestra
      );

      if (comparison > 0) {
        winnerIndex = i;
        bestCard = this.gameState.playedCards[i];
      }
    }

    const roundWinnerSocketId =
      this.gameState.playedCards[winnerIndex].playerSocketId;
    const roundWinnerIndex = this.gameState.playedCards[winnerIndex].playerId;
    this.gameState.roundWinners.push(roundWinnerIndex);

    const winnerData = this.room.players.get(roundWinnerSocketId);
    const winnerName = winnerData?.name || `Jugador ${roundWinnerIndex}`;
    console.log(
      `🏆 Ronda ${this.gameState.round} ganada por ${winnerName} (${roundWinnerSocketId})`
    );

    // Limpiar cartas jugadas
    this.gameState.playedCards = [];

    // El ganador de la ronda juega primero en la siguiente (usando TurnManager)
    this.turnManager.setCurrentPlayer(roundWinnerSocketId);
    this.gameState.currentPlayerSocketId = this.turnManager.getCurrentPlayer();
    this.gameState.round++;

    // Verificar si la mano terminó
    if (this.gameState.round > 3 || this.isHandFinished()) {
      this.resolveHand();
    }

    this.io.to(this.room.id).emit("roundFinished", {
      winner: roundWinnerIndex,
      winnerSocketId: roundWinnerSocketId,
      gameState: this.getPublicState(),
    });
  }

  // ========== MÉTODOS AUXILIARES ==========

  getPlayerIndex(socketId) {
    const playerIds = this.getPlayerSocketIds();
    return playerIds.indexOf(socketId);
  }

  getSocketIdByPlayerIndex(playerIndex) {
    const playerIds = this.getPlayerSocketIds();
    return playerIds[playerIndex] || null;
  }

  // El resto de métodos permanecen igual...
  sendPrivateHands() {
    console.log(`🎯 [Backend] sendPrivateHands - Enviando cartas a jugadores`);
    console.log(
      `🎯 [Backend] playerHands disponibles:`,
      this.gameState.playerHands
    );
    console.log(
      `🎯 [Backend] room.players:`,
      Array.from(this.room.players.keys())
    );

    this.room.players.forEach((player, socketId) => {
      const playerIndex = this.getPlayerIndex(socketId);
      console.log(`🎯 [Backend] Jugador ${socketId} -> índice ${playerIndex}`);

      if (playerIndex >= 0 && playerIndex < this.gameState.playerHands.length) {
        const hand = this.gameState.playerHands[playerIndex];
        const florInfo = hasFlor(hand, this.gameState.muestra);

        console.log(`🃏 [Backend] Enviando cartas a ${socketId}:`, hand);

        this.io.to(socketId).emit("privateHand", {
          hand: hand,
          envido: calculateEnvido(hand, this.gameState.muestra),
          flor: florInfo,
        });

        // Ya no sumamos automáticamente; el jugador debe declarar FLOR manualmente
      } else {
        console.error(
          `❌ [Backend] Error: Jugador ${socketId} no tiene cartas (índice ${playerIndex})`
        );
      }
    });

    // Tras enviar las manos, recalcular y emitir acciones disponibles para el jugador actual
    const cp = this.gameState.currentPlayerSocketId;
    if (cp) {
      this.io.to(this.room.id).emit("turnChanged", {
        previousPlayer: null,
        currentPlayer: cp,
        team: this.turnManager.getPlayerTeam(cp),
        direction: this.turnManager.getState().direction,
        availableActions: this.buildAvailableActions(cp),
      });
    }
  }

  // Métodos de envido, truco, etc. permanecen igual pero usando this.turnManager.isPlayerTurn()
  // para validar turnos en lugar de comparar socketIds manualmente

  skipEnvido(socketId) {
    console.log(`🚫 [Backend] skipEnvido llamado por ${socketId}`);

    if (!this.turnManager.isPlayerTurn(socketId)) {
      return { ok: false, reason: "not_your_turn" };
    }

    if (this.gameState.gamePhase !== "first_turn") {
      console.log(
        `🚫 [Backend] skipEnvido fallido - fase actual: ${this.gameState.gamePhase}`
      );
      return { ok: false, reason: "envido_only_first_turn" };
    }

    console.log(`✅ [Backend] skipEnvido exitoso - cambiando a fase playing`);
    this.gameState.gamePhase = "playing";

    const playerIndex = this.getPlayerIndex(socketId);
    this.io.to(this.room.id).emit("envidoSkipped", {
      player: playerIndex,
    });

    return { ok: true };
  }

  // ========== MÉTODOS RESTANTES ADAPTADOS CON TURNMANAGER ==========

  handleAutomaticFlor(playerIndex, florInfo) {
    const socketId = this.getSocketIdByPlayerIndex(playerIndex);
    const team = this.resolveTeamFrom(socketId, playerIndex);
    const florPoints = 3; // Flor vale 3 puntos

    // Sumar puntos automáticamente al equipo
    this.gameState.scores[team] += florPoints;

    // Registrar la flor en el estado
    if (!this.gameState.florState.declarations) {
      this.gameState.florState.declarations = new Map();
    }

    this.gameState.florState.declarations.set(playerIndex, {
      type: florInfo.type,
      suit: florInfo.suit,
      points: florPoints,
      automatic: true,
    });

    // Notificar a todos los jugadores sobre la flor
    this.io.to(this.room.id).emit("florDeclared", {
      playerId: playerIndex,
      florInfo: florInfo,
      points: florPoints,
      team: team,
      automatic: true,
    });

    console.log(
      `Flor automática para jugador ${playerIndex} (equipo ${team}): +${florPoints} puntos`
    );

    // Verificar si el equipo ganó el juego con la flor
    if (this.gameState.scores[team] >= 30) {
      setTimeout(() => {
        this.endGame(team);
      }, 2000); // Dar tiempo para que se vea la notificación de flor
    }
  }

  isHandFinished() {
    const winners = this.gameState.roundWinners;

    // Si hay 2 o 3 rondas jugadas, verificar si alguien ya ganó 2
    if (winners.length >= 2) {
      const counts = {};
      winners.forEach((winner) => {
        counts[winner] = (counts[winner] || 0) + 1;
      });

      return Object.values(counts).some((count) => count >= 2);
    }

    return false;
  }

  resolveHand() {
    // Determinar ganador de la mano
    const winners = this.gameState.roundWinners;
    const counts = {};

    winners.forEach((winner) => {
      counts[winner] = (counts[winner] || 0) + 1;
    });

    let handWinner = null;
    for (const [player, wins] of Object.entries(counts)) {
      if (wins >= 2) {
        handWinner = parseInt(player);
        break;
      }
    }

    if (handWinner !== null) {
      // Obtener el socketId del ganador para obtener su equipo con TurnManager
      const winnerSocketId = this.getSocketIdByPlayerIndex(handWinner);
      const team = this.resolveTeamFrom(winnerSocketId, handWinner);
      const points = this.calculateHandPoints();
      this.gameState.scores[team] += points;

      console.log(
        `🏆 Mano ${this.gameState.hand} ganada por jugador ${handWinner} (equipo ${team}). Puntos: ${points}`
      );

      // Verificar si alguien ganó el juego
      if (this.gameState.scores[team] >= 30) {
        this.endGame(team);
        return;
      }
    }

    // Iniciar nueva mano
    this.startNewHand();

    this.io.to(this.room.id).emit("handFinished", {
      winner: handWinner,
      points: this.calculateHandPoints(),
      gameState: this.getPublicState(),
    });
  }

  calculateHandPoints() {
    // Calcular puntos según el nivel de truco aceptado
    const trucoLevel = this.gameState.trucoState.level;

    switch (trucoLevel) {
      case 0:
        return 1; // Sin truco
      case 1:
        return 2; // Truco aceptado
      case 2:
        return 3; // Re-truco aceptado
      case 3:
        return 4; // Vale cuatro aceptado
      default:
        return 1;
    }
  }

  declareEnvido(socketId, type = "envido") {
    const playerIndex = this.getPlayerIndex(socketId);

    // Solo se puede cantar envido en el primer turno
    if (this.gameState.gamePhase !== "first_turn") {
      return { ok: false, reason: "envido_only_first_turn" };
    }

    // No se puede declarar envido si ya hay flor declarada en la mano
    const florDeclared = !!(
      this.gameState.florState?.declarations &&
      this.gameState.florState.declarations.size > 0
    );
    if (florDeclared) {
      return { ok: false, reason: "flor_in_progress" };
    }

    // Inicializar/actualizar cadena de envidos con reglas de "la palabra"
    if (!this.gameState.envidoState.active) {
      // Iniciar envido solo en tu turno
      if (!this.turnManager.isPlayerTurn(socketId)) {
        return { ok: false, reason: "not_your_turn" };
      }
      this.gameState.envidoState = {
        active: true,
        chain: [type],
        declarer: playerIndex, // último que cantó
        responses: new Map(),
        pot: this.getEnvidoPotFromChain([type]),
      };
    } else {
      // Envido activo: solo el respondedor (no el último que cantó) puede subir la apuesta
      const lastDeclarer = this.gameState.envidoState.declarer;
      if (playerIndex === lastDeclarer) {
        return { ok: false, reason: "not_responder_for_raise" };
      }
      // Aumentar apuesta (sumar al pote)
      const chain = Array.isArray(this.gameState.envidoState.chain)
        ? [...this.gameState.envidoState.chain, type]
        : [type];
      this.gameState.envidoState.chain = chain;
      this.gameState.envidoState.declarer = playerIndex;
      this.gameState.envidoState.pot = this.getEnvidoPotFromChain(chain);
    }

    this.io.to(this.room.id).emit("envidoDeclared", {
      declarer: playerIndex,
      type: type,
      chain: this.gameState.envidoState.chain,
      pot: this.gameState.envidoState.pot,
    });

    // Refrescar acciones: enviar al respondedor aceptar/no_acepto y posibles subidas
    const ids = this.getPlayerSocketIds();
    const responderIdx = ids.length === 2 ? (playerIndex === 0 ? 1 : 0) : null;
    const responderSocket =
      responderIdx !== null
        ? this.getSocketIdByPlayerIndex(responderIdx)
        : null;
    if (responderSocket) this.sendAvailableActionsTo(responderSocket);

    return { ok: true };
  }

  respondEnvido(socketId, response) {
    const playerIndex = this.getPlayerIndex(socketId);

    if (!this.gameState.envidoState.active) {
      return { ok: false, reason: "no_active_envido" };
    }

    // Solo puede responder el respondedor (no el último que cantó)
    const lastDeclarer = this.gameState.envidoState.declarer;
    if (playerIndex === lastDeclarer) {
      return { ok: false, reason: "not_responder_for_response" };
    }

    this.gameState.envidoState.responses.set(playerIndex, response);

    const state = this.gameState.envidoState;
    const lastDeclarerIdx = state.declarer;
    const lastDeclarerSocketId = this.getSocketIdByPlayerIndex(lastDeclarerIdx);
    const lastTeam = this.resolveTeamFrom(
      lastDeclarerSocketId,
      lastDeclarerIdx
    );

    if (response === "acepto") {
      this.resolveEnvido();
    } else if (response === "no_acepto") {
      // No acepta: puntos para quien hizo el último canto, según pote previo
      const prevPot = this.getEnvidoPreviousPotFromChain(state.chain);
      this.gameState.scores[lastTeam] += prevPot;

      this.io.to(this.room.id).emit("envidoDeclined", {
        by: playerIndex,
        winnerTeam: lastTeam,
        points: prevPot,
        chain: state.chain,
      });

      // Terminar el envido y pasar a jugar
      this.gameState.envidoState = {
        active: false,
        chain: [],
        declarer: null,
        responses: new Map(),
        pot: 0,
      };
      this.gameState.gamePhase = "playing";
    }

    this.io.to(this.room.id).emit("envidoResponse", {
      player: playerIndex,
      response: response,
      chain: this.gameState.envidoState.chain,
      pot: this.gameState.envidoState.pot,
    });

    // Refrescar acciones para ambos jugadores tras la respuesta
    const ids = this.getPlayerSocketIds();
    ids.forEach((id) => this.sendAvailableActionsTo(id));

    return { ok: true };
  }

  resolveEnvido() {
    const envidoValues = {};

    for (let i = 0; i < this.gameState.players; i++) {
      envidoValues[i] = calculateEnvido(
        this.gameState.playerHands[i],
        this.gameState.muestra
      );
    }

    // Determinar ganador (individual, no por equipo)
    let maxEnvido = -1;
    let winner = null;

    for (const [player, value] of Object.entries(envidoValues)) {
      if (value > maxEnvido) {
        maxEnvido = value;
        winner = parseInt(player);
      }
    }

    // Obtener el equipo del ganador usando helper robusto
    const winnerSocketId = this.getSocketIdByPlayerIndex(winner);
    const team = this.resolveTeamFrom(winnerSocketId, winner);
    const envidoPoints = this.getEnvidoPotFromChain(
      this.gameState.envidoState.chain
    );
    this.gameState.scores[team] += envidoPoints;

    this.io.to(this.room.id).emit("envidoResolved", {
      winner: winner,
      values: envidoValues,
      points: envidoPoints,
      team: team,
      chain: this.gameState.envidoState.chain,
    });

    console.log(
      `Envido ganado por jugador ${winner} (equipo ${team}) con ${maxEnvido} puntos. +${envidoPoints} puntos al equipo.`
    );

    // Pasar a fase de juego y limpiar estado de envido
    this.gameState.envidoState = {
      active: false,
      chain: [],
      declarer: null,
      responses: new Map(),
      pot: 0,
    };
    this.gameState.gamePhase = "playing";
  }

  // Puntos del canto individual
  getSingleEnvidoPoints(type) {
    if (type === "envido") return 2;
    if (type === "real_envido") return 3;
    if (type === "falta_envido") return this.getFaltaEnvidoPoints();
    return 0;
  }

  // Pote acumulado según la cadena de cantos (se suman)
  getEnvidoPotFromChain(chain = []) {
    if (!Array.isArray(chain) || chain.length === 0) return 0;
    return chain.reduce((sum, t) => sum + this.getSingleEnvidoPoints(t), 0);
  }

  // Pote previo para NO QUIERO: si solo hay 1 canto, usar mapeo (envido->1, real->2, falta->3)
  getEnvidoPreviousPotFromChain(chain = []) {
    if (!Array.isArray(chain) || chain.length === 0) return 0;
    if (chain.length === 1) {
      const t = chain[0];
      if (t === "envido") return 1;
      if (t === "real_envido") return 2;
      if (t === "falta_envido") return 3;
      return 0;
    }
    const prevChain = chain.slice(0, -1);
    return this.getEnvidoPotFromChain(prevChain);
  }

  // Cálculo de Falta Envido con buenas/malas (a 30 puntos, buenas a partir de 15)
  getFaltaEnvidoPoints() {
    const toWin = 30;
    const [a, b] = this.gameState.scores || [0, 0];
    const aBuenas = a >= toWin / 2;
    const bBuenas = b >= toWin / 2;
    if (!aBuenas && !bBuenas) {
      return toWin - Math.max(a, b);
    }
    if (aBuenas && !bBuenas) return toWin - a;
    if (!aBuenas && bBuenas) return toWin - b;
    // Ambos en buenas: por seguridad usar diferencia a 30 del mayor
    return toWin - Math.max(a, b);
  }

  // ========== MÉTODOS DE TRUCO ADAPTADOS ==========

  declareTruco(socketId, level = 1) {
    const playerIndex = this.getPlayerIndex(socketId);
    const playerTeam = this.resolveTeamFrom(socketId, playerIndex);

    // Validaciones
    if (this.gameState.gamePhase !== "playing") {
      return { ok: false, reason: "not_playing_phase" };
    }

    // Reglas de inicio/elevar
    const currentLevel = this.gameState.trucoState.level;
    if (currentLevel === 0) {
      // Iniciar truco solo en tu turno
      if (!this.turnManager.isPlayerTurn(socketId)) {
        return { ok: false, reason: "not_your_turn" };
      }
    } else {
      // Elevar solo el equipo con la palabra
      if (this.gameState.trucoState.teamWithWord !== playerTeam) {
        return { ok: false, reason: "no_word" };
      }
    }

    // Verificar que no se esté subiendo más del máximo
    if (level > 3 || level <= this.gameState.trucoState.level) {
      return { ok: false, reason: "invalid_level" };
    }

    // Actualizar estado del truco
    this.gameState.trucoState = {
      level: level,
      declarer: playerIndex,
      declarerTeam: playerTeam,
      accepted: false,
      teamWithWord: this.getOpposingTeam(playerTeam),
      pendingResponse: true,
    };

    // Determinar el nombre del canto
    const trucoNames = {
      1: "truco",
      2: "re-truco",
      3: "vale cuatro",
    };

    this.io.to(this.room.id).emit("trucoDeclared", {
      declarer: playerIndex,
      declarerTeam: playerTeam,
      level: level,
      name: trucoNames[level],
      teamWithWord: this.gameState.trucoState.teamWithWord,
    });

    // Refrescar acciones para el equipo respondedor
    const ids = this.getPlayerSocketIds();
    const responderTeam = playerTeam === 0 ? 1 : 0;
    ids.forEach((id) => {
      const team = this.resolveTeamFrom(id);
      if (team === responderTeam) this.sendAvailableActionsTo(id);
    });

    console.log(
      `${trucoNames[level]} cantado por jugador ${playerIndex} (equipo ${playerTeam})`
    );
    return { ok: true };
  }

  respondTruco(socketId, response) {
    const playerIndex = this.getPlayerIndex(socketId);
    const playerTeam = this.resolveTeamFrom(socketId, playerIndex);

    // Validaciones
    if (!this.gameState.trucoState.pendingResponse) {
      return { ok: false, reason: "no_pending_truco" };
    }

    if (playerTeam === this.gameState.trucoState.declarerTeam) {
      return { ok: false, reason: "cant_respond_own_truco" };
    }

    if (response === "acepto") {
      // Aceptar el truco
      this.gameState.trucoState.accepted = true;
      this.gameState.trucoState.pendingResponse = false;
      // La palabra pasa al equipo que aceptó
      this.gameState.trucoState.teamWithWord = playerTeam;

      this.io.to(this.room.id).emit("trucoAccepted", {
        responder: playerIndex,
        responderTeam: playerTeam,
        level: this.gameState.trucoState.level,
        points: this.getTrucoPoints(this.gameState.trucoState.level),
      });

      // Refrescar acciones post-aceptación (quien tiene la palabra puede subir)
      const ids = this.getPlayerSocketIds();
      ids.forEach((id) => this.sendAvailableActionsTo(id));

      console.log(
        `Truco aceptado por jugador ${playerIndex} (equipo ${playerTeam}). Se juega por ${this.getTrucoPoints(
          this.gameState.trucoState.level
        )} puntos.`
      );
    } else if (response === "no_acepto") {
      // No acepta - el equipo que cantó truco gana los puntos del nivel anterior
      const pointsWon = this.getTrucoPoints(
        this.gameState.trucoState.level - 1
      );
      this.gameState.scores[this.gameState.trucoState.declarerTeam] +=
        pointsWon;

      this.io.to(this.room.id).emit("trucoDeclined", {
        responder: playerIndex,
        responderTeam: playerTeam,
        winnerTeam: this.gameState.trucoState.declarerTeam,
        points: pointsWon,
      });

      console.log(
        `Truco no aceptado por jugador ${playerIndex}. Equipo ${this.gameState.trucoState.declarerTeam} gana ${pointsWon} puntos.`
      );

      // Verificar si ganaron el juego
      if (this.gameState.scores[this.gameState.trucoState.declarerTeam] >= 30) {
        this.endGame(this.gameState.trucoState.declarerTeam);
        return { ok: true };
      }

      // Comenzar nueva mano
      this.startNewHand();
      const ids = this.getPlayerSocketIds();
      ids.forEach((id) => this.sendAvailableActionsTo(id));
    }

    return { ok: true };
  }

  getTrucoPoints(level) {
    switch (level) {
      case 0:
        return 1; // Sin truco
      case 1:
        return 2; // Truco
      case 2:
        return 3; // Re-truco
      case 3:
        return 4; // Vale cuatro
      default:
        return 1;
    }
  }

  getTrucoLevelName(level) {
    const levels = ["", "truco", "re-truco", "vale cuatro"];
    return levels[level] || "";
  }

  getOpposingTeam(team) {
    return team === 0 ? 1 : 0;
  }

  startNewHand() {
    // Siguiente mano
    this.gameState.hand = (this.gameState.hand || 1) + 1;

    // Cambiar dealer usando TurnManager
    const playerIds = this.turnManager.players;
    const currentDealerIndex = playerIds.indexOf(
      this.gameState.currentDealerSocketId
    );
    const nextDealerIndex = (currentDealerIndex + 1) % playerIds.length;
    this.gameState.currentDealerSocketId = playerIds[nextDealerIndex];

    this.dealNewHand();
    this.gameState.gamePhase = "first_turn";

    // Log mejorado
    const dealerData = this.room.players.get(
      this.gameState.currentDealerSocketId
    );
    const dealerName = dealerData?.name || "Dealer desconocido";
    console.log(
      `🎯 Nueva mano #${this.gameState.hand}, dealer: ${dealerName} (${this.gameState.currentDealerSocketId})`
    );

    this.io.to(this.room.id).emit("newHandStarted", {
      hand: this.gameState.hand,
      dealerSocketId: this.gameState.currentDealerSocketId,
      gameState: this.getPublicState(),
    });

    this.sendPrivateHands();
  }

  endGame(winningTeam) {
    this.gameState.gameEnded = true;
    this.room.gameEnded = true;

    this.io.to(this.room.id).emit("gameOver", {
      winningTeam: winningTeam,
      finalScores: this.gameState.scores,
      gameState: this.getPublicState(),
      turnManagerState: this.turnManager.getState(),
    });

    console.log(`🏆 Juego terminado - Equipo ganador: ${winningTeam}`);
  }

  cleanup() {
    // Limpiar recursos si es necesario
    if (this.turnManager) {
      this.turnManager.reset();
    }
  }
}

module.exports = TrucoGameHandlerWithTurnManager;
