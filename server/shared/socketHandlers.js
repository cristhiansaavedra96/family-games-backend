const { syncPlayerWithDatabase } = require("./playerManager");

// Mapa para manejar períodos de gracia en desconexiones: socketId -> timeout
const pendingDisconnects = new Map();
// Estado de usuarios en background: socketId -> timestamp cuando pasó a background
const backgroundUsers = new Map();

/**
 * Crea los manejadores de eventos Socket.IO para gestión de salas
 * @param {object} dependencies - Dependencias necesarias
 * @returns {object} Objeto con todos los handlers de salas
 */
function createRoomHandlers({
  roomsManager,
  gameHandlers,
  getGameHandler,
  cleanupGameHandler,
  ensurePlayerInSingleRoom,
  broadcastRoomState,
  broadcastRoomsList,
  checkAllPlayersReady,
  io,
}) {
  return {
    // Listado y limpieza de salas
    listRooms: (socket) => () => {
      socket.emit("rooms", roomsManager.getRoomsList(gameHandlers));
    },

    cleanupRooms: (socket) => () => {
      // Limpiar salas vacías o inactivas
      const cleanedCount = roomsManager.cleanupEmptyRooms();

      // Limpiar game handlers huérfanos
      for (const roomId of gameHandlers.keys()) {
        if (!roomsManager.getRoom(roomId)) {
          cleanupGameHandler(roomId);
        }
      }

      console.log(`Limpieza completada: ${cleanedCount} salas eliminadas`);
      broadcastRoomsList();
    },

    // Crear sala
    createRoom:
      (socket) =>
      async ({ player, gameKey }) => {
        let { name, avatarUrl, username } = player || {};
        let avatarId = null;

        // Validar que el tipo de juego sea válido
        const validGameKeys = ["bingo", "truco"]; // Agregar truco como juego válido
        const selectedGameKey =
          gameKey && validGameKeys.includes(gameKey) ? gameKey : "bingo";

        // Asegurar que el jugador salga de cualquier sala anterior
        ensurePlayerInSingleRoom(socket);

        // Sincronizar jugador con base de datos
        const syncResult = await syncPlayerWithDatabase(
          username,
          name,
          avatarUrl
        );
        avatarUrl = syncResult.player.avatarUrl;
        avatarId = syncResult.avatarId;

        // Crear sala con configuración básica (sin configuraciones específicas de juego)
        const roomConfig = {
          speed: 1,
        };
        const room = roomsManager.createRoom(selectedGameKey, roomConfig);

        // El GameHandler se encarga automáticamente de inicializar su configuración por defecto
        getGameHandler(room.id);

        // Agregar jugador a la sala
        roomsManager.addPlayerToRoom(room.id, socket.id, {
          name,
          avatarUrl,
          avatarId,
          username,
          cards: [],
        });

        socket.join(room.id);
        socket.data.roomId = room.id;

        socket.emit("joined", {
          id: socket.id,
          hostId: room.hostId,
          roomId: room.id,
        });

        broadcastRoomState(room.id);
        broadcastRoomsList();
      },

    // Unirse a sala
    joinRoom:
      (socket) =>
      async ({ roomId, player }) => {
        const room = roomsManager.getRoom(roomId);
        if (!room) {
          socket.emit("joinError", { reason: "room_not_found" });
          return;
        }

        // Verificar límite máximo de jugadores para la sala
        const gameHandler = getGameHandler(roomId);
        const gameConfig = gameHandler ? gameHandler.getGameConfig() : {};
        const maxPlayers = gameConfig.maxPlayers || 6; // Por defecto 6 jugadores máximo

        // Contar jugadores actuales (sin contar al jugador que se está uniendo si ya está)
        const currentPlayerCount = room.players.has(socket.id)
          ? room.players.size
          : room.players.size + 1;

        if (currentPlayerCount > maxPlayers) {
          socket.emit("joinError", {
            reason: "room_full",
            maxPlayers: maxPlayers,
            currentCount: room.players.size,
          });
          return;
        }

        // Asegurar que el jugador salga de cualquier sala anterior (excepto la que está tratando de unirse)
        ensurePlayerInSingleRoom(socket, roomId);

        let { name, avatarUrl, username } = player || {};
        let avatarId = null;

        // Si existe un jugador en la sala con el mismo username y estaba pendiente de desconexión, cancelar el timeout
        if (username) {
          for (const [sockId, p] of room.players.entries()) {
            if (p.username === username && pendingDisconnects.has(sockId)) {
              clearTimeout(pendingDisconnects.get(sockId));
              pendingDisconnects.delete(sockId);
            }
          }
        }

        // Sincronizar jugador con base de datos
        const syncResult = await syncPlayerWithDatabase(
          username,
          name,
          avatarUrl
        );
        avatarUrl = syncResult.player.avatarUrl;
        avatarId = syncResult.avatarId;

        // Agregar jugador a la sala
        roomsManager.addPlayerToRoom(roomId, socket.id, {
          name,
          avatarUrl,
          avatarId,
          username,
          cards: [],
        });

        socket.join(roomId);
        socket.data.roomId = roomId;

        socket.emit("joined", {
          id: socket.id,
          hostId: room.hostId,
          roomId: room.id,
        });

        broadcastRoomState(roomId);
        broadcastRoomsList();
      },

    // Salir de sala
    leaveRoom: (socket) => () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const result = roomsManager.removePlayerFromRoom(roomId, socket.id);
      if (!result) return;

      const { room, shouldDelete, removedPlayer } = result;
      socket.leave(roomId);
      socket.data.roomId = null;

      // Notificación inmediata a restantes jugadores (sin esperar timeout de gracia)
      if (removedPlayer && room.players.size > 0) {
        try {
          io.to(room.id).emit("playerDisconnected", {
            username: removedPlayer.username,
            name: removedPlayer.name,
            avatarId: removedPlayer.avatarId,
            playerId: socket.id,
            roomId: room.id,
            voluntary: true,
            reason: "left",
            timestamp: Date.now(),
          });
        } catch (err) {
          console.error("Error emitiendo playerDisconnected (leaveRoom):", err);
        }
      }

      if (shouldDelete) {
        cleanupGameHandler(roomId);
        roomsManager.deleteRoom(roomId);
        broadcastRoomsList();
        return;
      }

      broadcastRoomState(roomId);
      broadcastRoomsList();
    },

    // Expulsar jugador (solo host)
    kickPlayer:
      (socket) =>
      ({ roomId, targetPlayerId }) => {
        const rid = roomId || socket.data.roomId;
        if (!rid) return;
        const room = roomsManager.getRoom(rid);
        if (!room) return;
        if (room.hostId !== socket.id) return; // Solo host
        if (!room.players.has(targetPlayerId)) return;

        const result = roomsManager.removePlayerFromRoom(rid, targetPlayerId);
        if (!result) return;
        const { room: updatedRoom, shouldDelete, removedPlayer } = result;

        // Notificar al expulsado
        try {
          const targetSocket =
            socket.server.sockets.sockets.get(targetPlayerId);
          if (targetSocket) {
            targetSocket.leave(rid);
            targetSocket.emit("kicked", { roomId: rid });
            targetSocket.data.roomId = null;
          }
        } catch (e) {
          console.error("Error notificando kick al jugador:", e);
        }

        // Notificación a restantes
        if (removedPlayer && updatedRoom.players.size > 0) {
          try {
            io.to(updatedRoom.id).emit("playerDisconnected", {
              username: removedPlayer.username,
              name: removedPlayer.name,
              avatarId: removedPlayer.avatarId,
              playerId: targetPlayerId,
              roomId: updatedRoom.id,
              reason: "kick",
              timestamp: Date.now(),
            });
          } catch (err) {
            console.error("Error emitiendo playerDisconnected (kick):", err);
          }
        }

        if (shouldDelete) {
          cleanupGameHandler(rid);
          roomsManager.deleteRoom(rid);
          broadcastRoomsList();
          return;
        }

        broadcastRoomState(rid);
        broadcastRoomsList();
      },

    // Jugador listo para nueva partida
    readyForNewGame:
      (socket) =>
      ({ roomId }) => {
        const room = roomsManager.setPlayerReady(
          roomId || socket.data.roomId,
          socket.id
        );
        if (!room) return;

        broadcastRoomState(room.id);

        // Verificar si todos están listos
        if (roomsManager.checkAllPlayersReady(room)) {
          checkAllPlayersReady(room);
        }
      },

    // Reclamación de figura
    claim:
      (socket) =>
      ({ roomId, figure, cardIndex, marked, debugMode }) => {
        try {
          const rid = roomId || socket.data.roomId;

          if (!rid) {
            console.error("Error: No roomId available");
            socket.emit("claimResult", { ok: false, reason: "no_room_id" });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler) {
            console.error("Error: No game handler available");
            socket.emit("claimResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const res = figure
            ? gameHandler.checkClaim(
                socket.id,
                figure,
                cardIndex,
                marked,
                require("../services/statsService"),
                require("../core/datastore").getDataStore(),
                !!debugMode
              )
            : gameHandler.autoClaim(
                socket.id,
                cardIndex,
                marked,
                require("../services/statsService"),
                require("../core/datastore").getDataStore(),
                !!debugMode
              );

          socket.emit("claimResult", res);

          if (res.ok && res.gameEnded) {
            broadcastRoomState(rid);
          }
        } catch (error) {
          console.error("Error procesando claim:", error);
          socket.emit("claimResult", { ok: false, reason: "server_error" });
        }
      },

    // Obtener estado de la sala
    getState:
      (socket) =>
      ({ roomId }) => {
        const room = roomsManager.getRoom(roomId || socket.data.roomId);
        if (!room) return;

        const publicPlayers = Array.from(room.players.entries()).map(
          ([sid, p]) => ({
            id: sid,
            name: p.name,
            avatarId: p.avatarId,
            username: p.username,
            cards: p.cards,
          })
        );

        // Obtener el estado específico del juego
        const gameHandler = getGameHandler(room.id);
        const gameState = gameHandler ? gameHandler.getPublicState() : {};
        const fullConfig = gameHandler
          ? gameHandler.getFullConfig()
          : room.config;

        socket.emit("state", {
          roomId: room.id,
          name: room.name,
          gameKey: room.gameKey,
          hostId: room.hostId,
          players: publicPlayers,
          // Configuración completa (sala + juego específico)
          ...fullConfig,
          // Estado del juego
          ...gameState,
          gameEnded: room.gameEnded,
          playersReady: Array.from(room.playersReady),
        });
      },

    // ========== TRUCO HANDLERS ==========

    // Jugar carta
    playCard:
      (socket) =>
      ({ roomId, cardId }) => {
        try {
          const rid = roomId || socket.data.roomId;
          if (!rid) {
            socket.emit("playCardResult", { ok: false, reason: "no_room_id" });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler || !gameHandler.playCard) {
            socket.emit("playCardResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const result = gameHandler.playCard(socket.id, cardId);
          socket.emit("playCardResult", result);

          if (result.ok) {
            broadcastRoomState(rid);
          }
        } catch (error) {
          console.error("Error playing card:", error);
          socket.emit("playCardResult", { ok: false, reason: "server_error" });
        }
      },

    // Re-enviar mano privada bajo demanda
    requestPrivateHand:
      (socket) =>
      ({ roomId }) => {
        try {
          const rid = roomId || socket.data.roomId;
          if (!rid) return;

          const gameHandler = getGameHandler(rid);
          if (!gameHandler || !gameHandler.sendPrivateHands) return;

          // Solo si el juego está iniciado
          if (gameHandler.gameState?.started) {
            gameHandler.sendPrivateHands();
          }
        } catch (error) {
          console.error("Error requesting private hand:", error);
        }
      },

    // Cantar envido
    envido:
      (socket) =>
      ({ roomId, type = "envido" }) => {
        try {
          const rid = roomId || socket.data.roomId;
          if (!rid) {
            socket.emit("envidoResult", { ok: false, reason: "no_room_id" });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler || !gameHandler.declareEnvido) {
            socket.emit("envidoResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const result = gameHandler.declareEnvido(socket.id, type);
          socket.emit("envidoResult", result);

          if (result.ok) {
            broadcastRoomState(rid);
          }
        } catch (error) {
          console.error("Error declaring envido:", error);
          socket.emit("envidoResult", { ok: false, reason: "server_error" });
        }
      },

    // Declarar Flor
    flor:
      (socket) =>
      ({ roomId }) => {
        try {
          const rid = roomId || socket.data.roomId;
          if (!rid) {
            socket.emit("florResult", { ok: false, reason: "no_room_id" });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler || !gameHandler.declareFlor) {
            socket.emit("florResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const result = gameHandler.declareFlor(socket.id);
          socket.emit("florResult", result);

          if (result.ok) {
            broadcastRoomState(rid);
          }
        } catch (error) {
          console.error("Error declaring flor:", error);
          socket.emit("florResult", { ok: false, reason: "server_error" });
        }
      },

    // Declarar ContraFlor
    contraflor:
      (socket) =>
      ({ roomId }) => {
        try {
          const rid = roomId || socket.data.roomId;
          if (!rid) {
            socket.emit("contraflorResult", {
              ok: false,
              reason: "no_room_id",
            });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler || !gameHandler.declareContraFlor) {
            socket.emit("contraflorResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const result = gameHandler.declareContraFlor(socket.id);
          socket.emit("contraflorResult", result);

          if (result.ok) {
            broadcastRoomState(rid);
          }
        } catch (error) {
          console.error("Error declaring contraflor:", error);
          socket.emit("contraflorResult", {
            ok: false,
            reason: "server_error",
          });
        }
      },

    // Responder al envido
    envidoResponse:
      (socket) =>
      ({ roomId, response }) => {
        try {
          const rid = roomId || socket.data.roomId;
          if (!rid) {
            socket.emit("envidoResponseResult", {
              ok: false,
              reason: "no_room_id",
            });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler || !gameHandler.respondEnvido) {
            socket.emit("envidoResponseResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const result = gameHandler.respondEnvido(socket.id, response);
          socket.emit("envidoResponseResult", result);

          if (result.ok) {
            broadcastRoomState(rid);
          }
        } catch (error) {
          console.error("Error responding to envido:", error);
          socket.emit("envidoResponseResult", {
            ok: false,
            reason: "server_error",
          });
        }
      },

    // No querer envido (pasar)
    skipEnvido:
      (socket) =>
      ({ roomId }) => {
        try {
          const rid = roomId || socket.data.roomId;
          if (!rid) {
            socket.emit("skipEnvidoResult", {
              ok: false,
              reason: "no_room_id",
            });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler || !gameHandler.skipEnvido) {
            socket.emit("skipEnvidoResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const result = gameHandler.skipEnvido(socket.id);
          socket.emit("skipEnvidoResult", result);

          if (result.ok) {
            broadcastRoomState(rid);
          }
        } catch (error) {
          console.error("Error skipping envido:", error);
          socket.emit("skipEnvidoResult", {
            ok: false,
            reason: "server_error",
          });
        }
      },

    // Cantar truco
    truco:
      (socket) =>
      (data = {}) => {
        try {
          const { roomId } = data;
          const rid = roomId || socket.data.roomId;
          if (!rid) {
            socket.emit("trucoResult", { ok: false, reason: "no_room_id" });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler || !gameHandler.declareTruco) {
            socket.emit("trucoResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const result = gameHandler.declareTruco(socket.id);
          socket.emit("trucoResult", result);

          if (result.ok) {
            broadcastRoomState(rid);
          }
        } catch (error) {
          console.error("Error declaring truco:", error);
          socket.emit("trucoResult", { ok: false, reason: "server_error" });
        }
      },

    // Responder al truco
    trucoResponse:
      (socket) =>
      (data = {}) => {
        try {
          const { roomId, response } = data;
          const rid = roomId || socket.data.roomId;
          if (!rid) {
            socket.emit("trucoResponseResult", {
              ok: false,
              reason: "no_room_id",
            });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler || !gameHandler.respondTruco) {
            socket.emit("trucoResponseResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const result = gameHandler.respondTruco(socket.id, response);
          socket.emit("trucoResponseResult", result);

          if (result.ok) {
            broadcastRoomState(rid);
          }
        } catch (error) {
          console.error("Error responding to truco:", error);
          socket.emit("trucoResponseResult", {
            ok: false,
            reason: "server_error",
          });
        }
      },
  };
}

/**
 * Crea los manejadores de eventos Socket.IO para el flujo del juego
 * @param {object} dependencies - Dependencias necesarias
 * @returns {object} Objeto con todos los handlers de juego
 */
function createGameFlowHandlers({
  roomsManager,
  getGameHandler,
  broadcastRoomState,
  broadcastRoomsList,
}) {
  return {
    // Configurar juego
    configure:
      (socket) =>
      ({ roomId, config }) => {
        const room = roomsManager.getRoom(roomId || socket.data.roomId);
        if (!room || room.hostId !== socket.id) return;

        // No permitir cambios si el juego ya empezó
        if (room.gameState?.started) return;

        // Configurar parámetros específicos del juego usando el GameHandler
        const gameHandler = getGameHandler(room.id);
        if (gameHandler && config) {
          gameHandler.setGameConfig(config);
        }

        broadcastRoomState(room.id);
        broadcastRoomsList();
      },

    // Establecer velocidad
    setSpeed:
      (socket) =>
      ({ roomId, speed }) => {
        const room = roomsManager.getRoom(roomId || socket.data.roomId);
        if (!room || room.hostId !== socket.id) return;

        const gameHandler = getGameHandler(room.id);
        if (gameHandler && gameHandler.setSpeed) {
          const success = gameHandler.setSpeed(speed);
          if (success) {
            broadcastRoomState(room.id);
          }
        }
      },

    // Iniciar juego
    startGame:
      (socket) =>
      ({ roomId }) => {
        const room = roomsManager.getRoom(roomId || socket.data.roomId);
        if (!room || room.hostId !== socket.id) {
          socket.emit("startGameError", { reason: "not_host_or_no_room" });
          return;
        }

        const gameHandler = getGameHandler(room.id);
        if (gameHandler) {
          const started = gameHandler.startGame();
          if (started !== false) {
            broadcastRoomState(room.id);
          } else {
            // El gameHandler devolvió false, enviar error específico
            socket.emit("startGameError", {
              reason: "insufficient_players",
              gameType: room.gameKey,
              currentPlayers: room.players.size,
            });
          }
        }
      },

    // Pausar sorteo
    pauseDraw:
      (socket) =>
      ({ roomId }) => {
        const room = roomsManager.getRoom(roomId || socket.data.roomId);
        if (!room || room.hostId !== socket.id) return;

        const gameHandler = getGameHandler(room.id);
        if (gameHandler && gameHandler.pauseDraw) {
          gameHandler.pauseDraw();
          broadcastRoomState(room.id);
        }
      },

    // Reanudar sorteo
    resumeDraw:
      (socket) =>
      ({ roomId }) => {
        const room = roomsManager.getRoom(roomId || socket.data.roomId);
        if (!room || room.hostId !== socket.id) return;

        const gameHandler = getGameHandler(room.id);
        if (gameHandler && gameHandler.resumeDraw) {
          gameHandler.resumeDraw();
          broadcastRoomState(room.id);
        }
      },

    // Siguiente bola (control manual)
    nextBall:
      (socket) =>
      ({ roomId }) => {
        const room = roomsManager.getRoom(roomId || socket.data.roomId);
        if (!room || room.hostId !== socket.id) return;

        const gameHandler = getGameHandler(room.id);
        if (gameHandler && gameHandler.forceNextBall) {
          const ball = gameHandler.forceNextBall();
          if (ball !== null) {
            broadcastRoomState(room.id);
          }
        }
      },

    // Reclamar victoria (claim)
    claim:
      (socket) =>
      ({ roomId, figure, cardIndex, marked, debugMode }) => {
        try {
          console.log(`Claim recibido de ${socket.id}:`, {
            roomId,
            figure,
            cardIndex,
            hasMarked: !!marked,
            debugMode: !!debugMode,
          });
          const rid = roomId || socket.data.roomId;

          if (!rid) {
            console.error("Error: No roomId available");
            socket.emit("claimResult", { ok: false, reason: "no_room_id" });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler) {
            console.error("Error: No game handler available");
            socket.emit("claimResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const res = figure
            ? gameHandler.checkClaim(
                socket.id,
                figure,
                cardIndex,
                marked,
                require("../services/statsService"),
                require("../core/datastore").getDataStore(),
                !!debugMode
              )
            : gameHandler.autoClaim(
                socket.id,
                cardIndex,
                marked,
                require("../services/statsService"),
                require("../core/datastore").getDataStore()
              );

          console.log(`Resultado del claim para ${socket.id}:`, res);
          socket.emit("claimResult", res);
          broadcastRoomState(rid);
        } catch (error) {
          console.error("Error procesando claim:", error);
          socket.emit("claimResult", { ok: false, reason: "server_error" });
        }
      },

    // Obtener estado de la sala
    getState:
      (socket) =>
      ({ roomId }) => {
        const room = roomsManager.getRoom(roomId || socket.data.roomId);
        if (!room) return;

        const publicPlayers = Array.from(room.players.entries()).map(
          ([sid, p]) => ({
            id: sid,
            name: p.name,
            avatarId: p.avatarId,
            username: p.username,
            cards: p.cards,
          })
        );

        // Obtener el estado específico del juego
        const gameHandler = getGameHandler(room.id);
        const gameState = gameHandler ? gameHandler.getPublicState() : {};
        const fullConfig = gameHandler
          ? gameHandler.getFullConfig()
          : room.config;

        socket.emit("state", {
          roomId: room.id,
          name: room.name,
          gameKey: room.gameKey,
          hostId: room.hostId,
          players: publicPlayers,
          // Configuración completa (sala + juego específico)
          ...fullConfig,
          // Estado del juego
          ...gameState,
          gameEnded: room.gameEnded,
          playersReady: Array.from(room.playersReady),
        });
      },

    // ========== TRUCO HANDLERS ==========

    // Jugar carta
    playCard:
      (socket) =>
      ({ roomId, cardId }) => {
        try {
          const rid = roomId || socket.data.roomId;
          if (!rid) {
            socket.emit("playCardResult", { ok: false, reason: "no_room_id" });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler || !gameHandler.playCard) {
            socket.emit("playCardResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const result = gameHandler.playCard(socket.id, cardId);
          socket.emit("playCardResult", result);

          if (result.ok) {
            broadcastRoomState(rid);
          }
        } catch (error) {
          console.error("Error playing card:", error);
          socket.emit("playCardResult", { ok: false, reason: "server_error" });
        }
      },

    // Cantar envido
    envido:
      (socket) =>
      ({ roomId, type = "envido" }) => {
        try {
          const rid = roomId || socket.data.roomId;
          if (!rid) {
            socket.emit("envidoResult", { ok: false, reason: "no_room_id" });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler || !gameHandler.declareEnvido) {
            socket.emit("envidoResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const result = gameHandler.declareEnvido(socket.id, type);
          socket.emit("envidoResult", result);

          if (result.ok) {
            broadcastRoomState(rid);
          }
        } catch (error) {
          console.error("Error declaring envido:", error);
          socket.emit("envidoResult", { ok: false, reason: "server_error" });
        }
      },

    // Responder al envido
    envidoResponse:
      (socket) =>
      ({ roomId, response }) => {
        try {
          const rid = roomId || socket.data.roomId;
          if (!rid) {
            socket.emit("envidoResponseResult", {
              ok: false,
              reason: "no_room_id",
            });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler || !gameHandler.respondEnvido) {
            socket.emit("envidoResponseResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const result = gameHandler.respondEnvido(socket.id, response);
          socket.emit("envidoResponseResult", result);

          if (result.ok) {
            broadcastRoomState(rid);
          }
        } catch (error) {
          console.error("Error responding to envido:", error);
          socket.emit("envidoResponseResult", {
            ok: false,
            reason: "server_error",
          });
        }
      },

    // No querer envido (pasar)
    skipEnvido:
      (socket) =>
      ({ roomId }) => {
        try {
          const rid = roomId || socket.data.roomId;
          if (!rid) {
            socket.emit("skipEnvidoResult", {
              ok: false,
              reason: "no_room_id",
            });
            return;
          }

          const gameHandler = getGameHandler(rid);
          if (!gameHandler || !gameHandler.skipEnvido) {
            socket.emit("skipEnvidoResult", {
              ok: false,
              reason: "no_game_handler",
            });
            return;
          }

          const result = gameHandler.skipEnvido(socket.id);
          socket.emit("skipEnvidoResult", result);

          if (result.ok) {
            broadcastRoomState(rid);
          }
        } catch (error) {
          console.error("Error skipping envido:", error);
          socket.emit("skipEnvidoResult", {
            ok: false,
            reason: "server_error",
          });
        }
      },
  };
}

/**
 * Crea los manejadores de eventos Socket.IO para estadísticas y datos
 * @param {object} handlers - Handlers modulares ya creados
 * @returns {object} Objeto con todos los handlers de stats
 */
function createStatsHandlers({
  getStatsHandler,
  getLeaderboardHandler,
  getTopPlayersHandler,
  searchPlayersHandler,
  getAvatarHandler,
  getAvatarByIdHandler,
  syncAvatarsHandler,
  checkAvatarsHandler,
  updateProfileHandler,
  compressAllAvatarsHandler,
}) {
  return {
    // Estadísticas
    getStats:
      (socket) =>
      async ({ playerId }, cb) => {
        await getStatsHandler({ playerId }, cb, socket.id, socket.data.roomId);
      },

    getLeaderboard:
      (socket) =>
      async ({ gameKey, limit }, cb) => {
        await getLeaderboardHandler({ gameKey, limit }, cb);
      },

    getTopPlayers: (socket) => async (params, cb) => {
      await getTopPlayersHandler(params, cb);
    },

    searchPlayers:
      (socket) =>
      async ({ query, limit }, cb) => {
        await searchPlayersHandler({ query, limit }, cb);
      },

    // Gestión de avatares
    getAvatar:
      (socket) =>
      async ({ avatarId, clientHasCache }, cb) => {
        await getAvatarHandler({ avatarId, clientHasCache }, cb);
      },

    getAvatarById:
      (socket) =>
      async ({ avatarId }, cb) => {
        await getAvatarByIdHandler({ avatarId }, cb);
      },

    syncAvatars:
      (socket) =>
      async ({ lastSync }, cb) => {
        await syncAvatarsHandler({ lastSync }, cb);
      },

    checkAvatars:
      (socket) =>
      async ({ avatarIds, clientCachedIds }, cb) => {
        await checkAvatarsHandler({ avatarIds, clientCachedIds }, cb);
      },

    // Gestión de perfiles
    updateProfile:
      (socket) =>
      async ({ username, name, avatarUrl }, cb) => {
        await updateProfileHandler(
          { username, name, avatarUrl },
          cb,
          socket.id
        );
      },

    compressAllAvatars: (socket) => async (data, cb) => {
      await compressAllAvatarsHandler(data, cb);
    },
  };
}

/**
 * Crea los manejadores de eventos Socket.IO para chat
 * @param {object} dependencies - Dependencias necesarias
 * @returns {object} Objeto con todos los handlers de chat
 */
function createChatHandlers({ roomsManager, io }) {
  return {
    sendChatMessage:
      (socket) =>
      ({ roomId, message }) => {
        console.log("Received chat message:", { roomId, message });
        const room = roomsManager.getRoom(roomId || socket.data.roomId);
        if (!room) {
          console.log("Room not found for chat message");
          return;
        }

        // Verificar que el jugador está en la sala
        if (!room.players.has(socket.id)) {
          console.log("Player not in room for chat message");
          return;
        }

        console.log(
          "Broadcasting chat message to room:",
          roomId || socket.data.roomId
        );
        // Reenviar el mensaje a todos en la sala
        io.to(roomId || socket.data.roomId).emit("chatMessage", message);
      },
    // Marcar que la app pasó a background (para ampliar período de gracia)
    appBackground: (socket) => () => {
      backgroundUsers.set(socket.id, Date.now());
    },
    // Marcar que la app volvió a foreground
    appForeground: (socket) => () => {
      backgroundUsers.delete(socket.id);
    },
  };
}

/**
 * Crea el manejador de desconexión
 * @param {object} dependencies - Dependencias necesarias
 * @returns {function} Handler de disconnect
 */
function createDisconnectHandler({
  roomsManager,
  cleanupGameHandler,
  broadcastRoomState,
  broadcastRoomsList,
  io,
}) {
  return (socket) => () => {
    // Determinar si el jugador es host de alguna sala para extender siempre el período de gracia
    let isHostSomewhere = false;
    for (const room of roomsManager.getAllRooms()) {
      if (room.hostId === socket.id) {
        isHostSomewhere = true;
        break;
      }
    }
    // Si el usuario estaba en background recientemente, o es host, darle gracia extendida (5 minutos)
    const wasBackground = backgroundUsers.has(socket.id);
    const EXTENDED_GRACE_MS = 5 * 60 * 1000;
    const DEFAULT_GRACE_MS = 15000;
    const graceMs =
      wasBackground || isHostSomewhere ? EXTENDED_GRACE_MS : DEFAULT_GRACE_MS;
    console.log(
      `[Disconnect] Socket ${socket.id} scheduled removal in ${graceMs}ms (background=${wasBackground} host=${isHostSomewhere})`
    );
    const toSchedule = setTimeout(() => {
      // Remover el jugador de todas las salas donde pueda estar
      const removedResults = roomsManager.removePlayerFromAllRooms(socket.id);
      pendingDisconnects.delete(socket.id);
      backgroundUsers.delete(socket.id);

      if (removedResults.length === 0) return;

      // Procesar cada sala de la que fue removido
      for (const result of removedResults) {
        const { room, shouldDelete, removedPlayer } = result;

        if (shouldDelete) {
          // Limpiar game handler y eliminar sala
          cleanupGameHandler(room.id);
          roomsManager.deleteRoom(room.id);
          console.log(`Eliminando sala ${room.id} por falta de jugadores`);
        } else {
          // Solo notificar cambios en la sala
          broadcastRoomState(room.id);
        }

        // Emitir notificación de desconexión a los jugadores restantes de la sala
        if (removedPlayer && room.players.size > 0) {
          try {
            io.to(room.id).emit("playerDisconnected", {
              username: removedPlayer.username,
              name: removedPlayer.name,
              avatarId: removedPlayer.avatarId,
              playerId: socket.id,
              roomId: room.id,
              reason: "timeout",
              timestamp: Date.now(),
            });
          } catch (err) {
            console.error("Error emitiendo playerDisconnected:", err);
          }
        }
      }

      // Actualizar lista de salas una sola vez al final
      broadcastRoomsList();
      socket.data.roomId = null;
    }, graceMs);

    pendingDisconnects.set(socket.id, toSchedule);
  };
}

module.exports = {
  createRoomHandlers,
  createGameFlowHandlers,
  createStatsHandlers,
  createChatHandlers,
  createDisconnectHandler,
};
