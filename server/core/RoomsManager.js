// Gestor de salas - Maneja la lógica común a todos los juegos
class RoomsManager {
  constructor() {
    this.rooms = new Map(); // roomId -> Room instance
    this.roomCounter = 1;
  }

  // Encuentra el número de sala más bajo disponible
  getAvailableRoomNumber() {
    let roomNumber = 1;
    while (true) {
      const roomId = String(roomNumber);
      if (!this.rooms.has(roomId)) {
        return roomNumber;
      }
      roomNumber++;
    }
  }

  // Encuentra el jugador más antiguo (por joinedAt)
  getOldestPlayer(room) {
    if (room.players.size === 0) return null;

    let oldestPlayerId = null;
    let oldestJoinTime = Infinity;

    for (const [playerId, playerData] of room.players) {
      if (playerData.joinedAt < oldestJoinTime) {
        oldestJoinTime = playerData.joinedAt;
        oldestPlayerId = playerId;
      }
    }

    return oldestPlayerId;
  }

  // Crea una nueva sala
  createRoom(gameKey = "bingo", config = {}) {
    const roomNumber = this.getAvailableRoomNumber();
    const id = String(roomNumber);

    const room = {
      id,
      name: `Sala ${roomNumber}`,
      gameKey,
      players: new Map(), // socketId -> { name, avatarUrl, avatarId, username, joinedAt }
      hostId: null,
      // Configuración común de la sala (sin configuraciones específicas de juegos)
      config: {
        speed: config.speed || 1,
        // Las configuraciones específicas de juegos se manejan en el GameHandler
        ...config,
      },
      // Estado del juego (será manejado por el GameHandler específico)
      gameState: null,
      // Control de nueva partida
      gameEnded: false,
      playersReady: new Set(),
    };

    this.rooms.set(id, room);
    return room;
  }

  // Obtiene una sala por ID
  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  // Obtiene todas las salas
  getAllRooms() {
    return Array.from(this.rooms.values());
  }

  // Lista pública de salas - Nota: necesita acceso a gameHandlers para obtener config completa
  getRoomsList(gameHandlers = null) {
    return Array.from(this.rooms.values()).map((r) => {
      const baseRoom = {
        id: r.id,
        name: r.name,
        gameKey: r.gameKey,
        players: Array.from(r.players.entries()).map(([sid, p]) => ({
          id: sid,
          name: p.name,
          avatarId: p.avatarId,
          username: p.username,
        })),
        started: r.gameState?.started || false,
        hostId: r.hostId,
        speed: r.config.speed,
      };

      // Intentar obtener configuración específica del juego si hay gameHandlers
      if (gameHandlers && gameHandlers.has(r.id)) {
        const gameHandler = gameHandlers.get(r.id);
        const gameConfig = gameHandler.getGameConfig();
        return { ...baseRoom, ...gameConfig };
      }

      return baseRoom;
    });
  }

  // Encuentra en qué sala está un jugador específico
  findPlayerRoom(socketId) {
    for (const room of this.rooms.values()) {
      if (room.players.has(socketId)) {
        return room;
      }
    }
    return null;
  }

  // Remueve un jugador de todas las salas donde esté
  removePlayerFromAllRooms(socketId) {
    const removedFrom = [];

    for (const room of this.rooms.values()) {
      if (room.players.has(socketId)) {
        const result = this.removePlayerFromRoom(room.id, socketId);
        if (result) {
          removedFrom.push(result);
        }
      }
    }

    return removedFrom;
  }

  // Agrega un jugador a una sala
  addPlayerToRoom(roomId, socketId, playerData) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    // Eliminar cualquier jugador anterior con el mismo username
    if (playerData.username) {
      for (const [sockId, p] of room.players.entries()) {
        if (p.username && p.username === playerData.username) {
          room.players.delete(sockId);
          room.playersReady && room.playersReady.delete(sockId);
        }
      }
    }

    room.players.set(socketId, {
      ...playerData,
      joinedAt: Date.now(),
    });

    if (!room.hostId) {
      room.hostId = socketId;
    }

    return room;
  }

  // Remueve un jugador de una sala
  removePlayerFromRoom(roomId, socketId) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    room.players.delete(socketId);
    room.playersReady.delete(socketId);

    // Si era el anfitrión, transferir anfitrionazgo o marcar para eliminación
    if (socketId === room.hostId) {
      if (room.players.size === 0) {
        return { room, shouldDelete: true };
      } else {
        room.hostId = this.getOldestPlayer(room);
      }
    }

    // Si no hay más jugadores, marcar para eliminación
    if (room.players.size === 0) {
      return { room, shouldDelete: true };
    }

    return { room, shouldDelete: false };
  }

  // Elimina una sala
  deleteRoom(roomId) {
    return this.rooms.delete(roomId);
  }

  // Configura una sala (solo el host puede hacerlo)
  configureRoom(roomId, hostId, newConfig) {
    const room = this.getRoom(roomId);
    if (!room || room.hostId !== hostId) return null;

    // No permitir cambios si el juego ya empezó
    if (room.gameState?.started) return null;

    room.config = {
      ...room.config,
      ...newConfig,
    };

    return room;
  }

  // Marca un jugador como listo para nueva partida
  setPlayerReady(roomId, socketId) {
    const room = this.getRoom(roomId);
    if (!room || !room.gameEnded) return null;

    room.playersReady.add(socketId);
    return room;
  }

  // Verifica si todos los jugadores están listos
  checkAllPlayersReady(room) {
    const totalPlayers = room.players.size;
    const readyPlayers = room.playersReady.size;
    return totalPlayers > 0 && readyPlayers === totalPlayers;
  }

  // Limpieza automática de salas huérfanas
  cleanupEmptyRooms() {
    let cleanedCount = 0;
    for (const [roomId, room] of this.rooms.entries()) {
      const shouldDelete = room.players.size === 0;

      if (shouldDelete) {
        console.log(`[AutoCleanup] Eliminando sala huérfana ${roomId}`);
        this.rooms.delete(roomId);
        cleanedCount++;
      }
    }
    return cleanedCount;
  }
}

module.exports = RoomsManager;
