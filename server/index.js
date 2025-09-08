// Servidor Node.js + Socket.IO - Refactorizado con RoomsManager y GameHandlers
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const RoomsManager = require("./core/RoomsManager");
const GameHandlerFactory = require("./games/GameHandlerFactory");
const {
  createUpdateProfileHandler,
  createCompressAllAvatarsHandler,
} = require("./shared/playerManager");
const {
  createGetStatsHandler,
  createGetLeaderboardHandler,
  createGetTopPlayersHandler,
  createSearchPlayersHandler,
  createGetPlayerProfileHandler,
} = require("./shared/statsHandler");
const {
  createGetAvatarHandler,
  createGetAvatarByIdHandler,
  createSyncAvatarsHandler,
  createCheckAvatarsHandler,
} = require("./shared/avatarHandler");
const {
  createRoomHandlers,
  createGameFlowHandlers,
  createStatsHandlers,
  createChatHandlers,
  createDisconnectHandler,
} = require("./shared/socketHandlers");

dotenv.config();

const PORT = process.env.PORT || 4000;
const ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
app.use(cors({ origin: ORIGIN }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGIN } });

// Gestor de salas y manejadores de juegos
const roomsManager = new RoomsManager();
const gameHandlers = new Map(); // roomId -> GameHandler instance

// Función para obtener o crear un game handler
function getGameHandler(roomId) {
  let handler = gameHandlers.get(roomId);
  if (!handler) {
    const room = roomsManager.getRoom(roomId);
    if (room) {
      handler = GameHandlerFactory.createHandler(room.gameKey, room, io);
      gameHandlers.set(roomId, handler);
    }
  }
  return handler;
}

// Función para limpiar game handler cuando se elimina una sala
function cleanupGameHandler(roomId) {
  const handler = gameHandlers.get(roomId);
  if (handler && typeof handler.cleanup === "function") {
    handler.cleanup();
  }
  gameHandlers.delete(roomId);
}

// Función para asegurar que un jugador solo esté en una sala
function ensurePlayerInSingleRoom(socket, targetRoomId = null) {
  console.log(
    `[DEBUG] ensurePlayerInSingleRoom called for player: ${socket.id}, targetRoom: ${targetRoomId}`
  );
  const currentRoom = roomsManager.findPlayerRoom(socket.id);

  if (currentRoom && currentRoom.id !== targetRoomId) {
    console.log(
      `🔄 Jugador ${socket.id} saliendo automáticamente de sala ${currentRoom.id}`
    );

    // Remover de la sala actual
    const result = roomsManager.removePlayerFromRoom(currentRoom.id, socket.id);
    socket.leave(currentRoom.id);

    // Limpiar game handler si la sala debe eliminarse
    if (result && result.shouldDelete) {
      cleanupGameHandler(currentRoom.id);
      roomsManager.deleteRoom(currentRoom.id);
    } else if (result) {
      // Notificar cambios en la sala
      broadcastRoomState(currentRoom.id);
    }

    // Limpiar el roomId del socket si no va a otra sala
    if (!targetRoomId) {
      socket.data.roomId = null;
    }

    // Actualizar lista de salas
    broadcastRoomsList();

    return currentRoom;
  }

  return null;
}

function broadcastRoomsList() {
  io.emit("rooms", roomsManager.getRoomsList(gameHandlers));
}

function broadcastRoomState(roomId) {
  const room = roomsManager.getRoom(roomId);
  if (!room) return;

  const publicPlayers = Array.from(room.players.entries()).map(([sid, p]) => ({
    id: sid,
    name: p.name,
    avatarUrl: p.avatarUrl,
    avatarId: p.avatarId,
    username: p.username,
    cards: p.cards,
  }));

  // Obtener el estado específico del juego
  const gameHandler = getGameHandler(roomId);
  const gameState = gameHandler ? gameHandler.getPublicState() : {};
  const fullConfig = gameHandler ? gameHandler.getFullConfig() : room.config;

  console.log(
    `📡 [Backend] Broadcasting room state - Room: ${roomId}, GameKey: ${
      room.gameKey
    }, GameHandler exists: ${!!gameHandler}`
  );
  if (gameHandler && room.gameKey === "truco") {
    console.log(
      `🎯 [Backend] Truco game state keys: ${Object.keys(gameState).join(", ")}`
    );
  }

  const stateToSend = {
    roomId,
    name: room.name,
    gameKey: room.gameKey,
    hostId: room.hostId,
    players: publicPlayers,
    gameEnded: room.gameEnded,
    playersReady: Array.from(room.playersReady),
    // Configuración completa (sala + juego específico)
    ...fullConfig,
    // Estado del juego (debe tener prioridad)
    ...gameState,
  };

  console.log(
    `📡 [Backend] Final state to send - currentPlayerSocketId: ${stateToSend.currentPlayerSocketId}, gamePhase: ${stateToSend.gamePhase}`
  );

  io.to(roomId).emit("state", stateToSend);
}

// Verificar si todos los jugadores están listos para nueva partida
function checkAllPlayersReady(room) {
  const totalPlayers = room.players.size;
  const readyPlayers = room.playersReady.size;

  if (totalPlayers > 0 && readyPlayers === totalPlayers) {
    // Todos están listos, iniciar nueva partida
    setTimeout(() => {
      const gameHandler = getGameHandler(room.id);
      if (gameHandler) {
        gameHandler.startGame();
        broadcastRoomState(room.id);
      }
    }, 1000);
  }
}

// 🔧 NUEVA FUNCIÓN: Limpieza automática de salas huérfanas
function automaticRoomCleanup() {
  const cleanedCount = roomsManager.cleanupEmptyRooms();
  if (cleanedCount > 0) {
    console.log(
      `[AutoCleanup] Limpieza automática completada: ${cleanedCount} salas eliminadas`
    );
    // Limpiar game handlers huérfanos
    for (const roomId of gameHandlers.keys()) {
      if (!roomsManager.getRoom(roomId)) {
        cleanupGameHandler(roomId);
      }
    }
    broadcastRoomsList();
  }
}

// Ejecutar limpieza automática cada 5 minutos
setInterval(automaticRoomCleanup, 5 * 60 * 1000); // 5 minutos

// Crear handlers para gestión de jugadores usando las funciones modulares
const updateProfileHandler = createUpdateProfileHandler(
  roomsManager,
  broadcastRoomState
);
const compressAllAvatarsHandler = createCompressAllAvatarsHandler();

// Crear handlers para estadísticas y rankings
const getStatsHandler = createGetStatsHandler(roomsManager);
const getLeaderboardHandler = createGetLeaderboardHandler();
const getTopPlayersHandler = createGetTopPlayersHandler();
const searchPlayersHandler = createSearchPlayersHandler();
const getPlayerProfileHandler = createGetPlayerProfileHandler();
const getAvatarHandler = createGetAvatarHandler();
const getAvatarByIdHandler = createGetAvatarByIdHandler();
const syncAvatarsHandler = createSyncAvatarsHandler();
const checkAvatarsHandler = createCheckAvatarsHandler();

// Crear handlers Socket.IO organizados por categorías
const roomHandlers = createRoomHandlers({
  roomsManager,
  gameHandlers,
  getGameHandler,
  cleanupGameHandler,
  ensurePlayerInSingleRoom,
  broadcastRoomState,
  broadcastRoomsList,
  checkAllPlayersReady,
  io,
});

const gameFlowHandlers = createGameFlowHandlers({
  roomsManager,
  getGameHandler,
  broadcastRoomState,
  broadcastRoomsList,
});

const statsHandlers = createStatsHandlers({
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
});

const chatHandlers = createChatHandlers({
  roomsManager,
  io,
});

const disconnectHandler = createDisconnectHandler({
  roomsManager,
  cleanupGameHandler,
  broadcastRoomState,
  broadcastRoomsList,
  io,
});

io.on("connection", (socket) => {
  // Listado inicial de salas
  socket.emit("rooms", roomsManager.getRoomsList(gameHandlers));

  // 🏠 Eventos de Salas
  socket.on("listRooms", roomHandlers.listRooms(socket));
  socket.on("cleanupRooms", roomHandlers.cleanupRooms(socket));
  socket.on("createRoom", roomHandlers.createRoom(socket));
  socket.on("joinRoom", roomHandlers.joinRoom(socket));
  socket.on("leaveRoom", roomHandlers.leaveRoom(socket));
  socket.on("kickPlayer", roomHandlers.kickPlayer(socket));
  socket.on("readyForNewGame", roomHandlers.readyForNewGame(socket));

  // 🎮 Eventos de Flujo del Juego
  socket.on("configure", gameFlowHandlers.configure(socket));
  socket.on("setSpeed", gameFlowHandlers.setSpeed(socket));
  socket.on("startGame", gameFlowHandlers.startGame(socket));
  socket.on("getState", gameFlowHandlers.getState(socket));

  // 🎮 Eventos de Flujo del Juego Bingo
  socket.on("pauseDraw", gameFlowHandlers.pauseDraw(socket));
  socket.on("resumeDraw", gameFlowHandlers.resumeDraw(socket));
  socket.on("nextBall", gameFlowHandlers.nextBall(socket));
  socket.on("claim", gameFlowHandlers.claim(socket));

  // 🃏 Eventos específicos del Truco
  socket.on("playCard", roomHandlers.playCard(socket));
  socket.on("envido", roomHandlers.envido(socket));
  socket.on("envidoResponse", roomHandlers.envidoResponse(socket));
  socket.on("skipEnvido", roomHandlers.skipEnvido(socket));
  socket.on("truco", roomHandlers.truco(socket));
  socket.on("trucoResponse", roomHandlers.trucoResponse(socket));
  socket.on("requestPrivateHand", roomHandlers.requestPrivateHand(socket));

  // � Eventos específicos de UNO (faltaban bindings)
  socket.on("drawCard", roomHandlers.drawCard(socket));
  socket.on("declareUno", roomHandlers.declareUno(socket));
  socket.on("callOutUno", roomHandlers.callOutUno(socket));
  socket.on("challengeWild4", roomHandlers.challengeWild4(socket));
  socket.on("acceptWild4", roomHandlers.acceptWild4(socket));

  // 🛰 Logger genérico para depuración (se puede retirar luego)
  socket.onAny((event, ...args) => {
    if (
      [
        "drawCard",
        "playCard",
        "declareUno",
        "callOutUno",
        "challengeWild4",
        "acceptWild4",
      ].includes(event)
    ) {
      try {
        const payload = args && args[0];
        console.log(
          `⚡ [onAny] Evento '${event}' recibido de ${socket.id}`,
          payload && typeof payload === "object" ? payload : ""
        );
      } catch (e) {
        // ignorar
      }
    }
  });

  // �📊 Eventos de Estadísticas y Perfiles
  socket.on("getStats", statsHandlers.getStats(socket));
  socket.on("getLeaderboard", statsHandlers.getLeaderboard(socket));
  socket.on("getTopPlayers", statsHandlers.getTopPlayers(socket));
  socket.on("searchPlayers", statsHandlers.searchPlayers(socket));
  socket.on("getPlayerProfile", async (payload, cb) => {
    try {
      const res = await getPlayerProfileHandler(payload, cb);
      if (cb && typeof cb === "function" && !res) return; // cb ya respondido
    } catch (e) {
      if (cb) cb({ ok: false, error: e.message });
    }
  });
  socket.on("getAvatar", statsHandlers.getAvatar(socket));
  socket.on("getAvatarById", statsHandlers.getAvatarById(socket));
  socket.on("syncAvatars", statsHandlers.syncAvatars(socket));
  socket.on("checkAvatars", statsHandlers.checkAvatars(socket));
  socket.on("updateProfile", statsHandlers.updateProfile(socket));
  socket.on("compressAllAvatars", statsHandlers.compressAllAvatars(socket));

  // 💬 Eventos de Chat
  socket.on("sendChatMessage", chatHandlers.sendChatMessage(socket));

  // 🔌 Desconexión
  socket.on("disconnect", disconnectHandler(socket));
});

app.get("/", (_req, res) => res.send("Bingo backend OK"));

const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () =>
  console.log(`Backend listening on ${HOST}:${PORT}`)
);
