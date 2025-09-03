const statsService = require("../services/statsService");
const { getDataStore } = require("../core/datastore");
const {
  compressAvatar,
  validateAvatarFormat,
  validateAvatarSize,
} = require("./avatarUtils");

const dataStore = getDataStore();

/**
 * Sincroniza un jugador con la base de datos y el dataStore
 * @param {string} username - Username del jugador
 * @param {string} name - Nombre del jugador
 * @param {string} avatarUrl - Avatar en base64
 * @returns {Promise<{player, avatarId}>} Datos del jugador sincronizado
 */
async function syncPlayerWithDatabase(username, name, avatarUrl) {
  let avatarId = null;

  try {
    if (username) {
      const existingPlayer = await statsService.getPlayerByUsername(username);
      if (existingPlayer && existingPlayer.avatarUrl) {
        console.log(
          `🔄 Avatar sincronizado para ${username}: ${existingPlayer.avatarId}`
        );
        avatarUrl = existingPlayer.avatarUrl;
        avatarId = existingPlayer.avatarId;
      }
      const player = await statsService.ensurePlayer(username, name, avatarUrl);
      avatarId = player.avatarId;
      return { player, avatarId };
    }
    dataStore.ensurePlayer(username || "anonymous", name, avatarUrl);
  } catch (e) {
    console.warn("Error syncing player with database:", e);
  }

  return {
    player: {
      username,
      name,
      avatarUrl: avatarUrl
        ? `[avatar-${(avatarUrl.length / 1024).toFixed(1)}KB]`
        : null,
    },
    avatarId,
  };
}

/**
 * Procesa un avatar (validación + compresión si es necesario)
 * @param {string} avatarUrl - Avatar en formato base64
 * @returns {Promise<string>} Avatar procesado y comprimido si es necesario
 */
async function processAvatar(avatarUrl) {
  if (!avatarUrl) return null;

  console.log("🖼️ Processing avatar...");
  console.log(
    "   - Original size:",
    (avatarUrl.length / 1024).toFixed(2),
    "KB"
  );

  // Validar formato de imagen
  if (!validateAvatarFormat(avatarUrl)) {
    throw new Error("Formato de imagen inválido");
  }

  // Validar tamaño máximo original (5MB para dar margen de maniobra)
  if (!validateAvatarSize(avatarUrl, 5)) {
    throw new Error("La imagen es demasiado grande (máximo 5MB)");
  }

  let processedAvatarUrl = avatarUrl;

  try {
    // Comprimir avatar si es mayor a 50KB
    if (avatarUrl.length > 50 * 1024) {
      console.log("🔧 Avatar needs compression, processing...");
      processedAvatarUrl = await compressAvatar(avatarUrl, 50); // Target: 50KB
    } else {
      console.log("✅ Avatar size OK, no compression needed");
    }
  } catch (compressionError) {
    console.error("❌ Avatar compression failed:", compressionError);
    throw new Error("Error procesando la imagen: " + compressionError.message);
  }

  return processedAvatarUrl;
}

/**
 * Sincroniza el perfil de un jugador en todas las salas donde esté presente
 * @param {object} roomsManager - Gestor de salas
 * @param {string} socketId - ID del socket del jugador
 * @param {string} username - Username del jugador
 * @param {object} playerData - Datos actualizados del jugador
 * @param {function} broadcastRoomState - Función para broadcast del estado
 * @returns {number} Número de salas actualizadas
 */
function syncPlayerProfileAcrossRooms(
  roomsManager,
  socketId,
  username,
  playerData,
  broadcastRoomState
) {
  console.log("🔄 Syncing updated profile across rooms...");
  let roomsUpdated = 0;

  for (const room of roomsManager.getAllRooms()) {
    const playerInRoom = room.players.get(socketId);
    if (playerInRoom && playerInRoom.username === username) {
      // Actualizar los datos del jugador en esta sala
      room.players.set(socketId, {
        ...playerInRoom,
        name: playerData.name,
        avatarUrl: playerData.avatarUrl,
        avatarId: playerData.avatarId,
      });

      // Notificar a todos en la sala sobre la actualización
      console.log(`📡 Broadcasting updated profile to room ${room.id}`);
      broadcastRoomState(room.id);
      roomsUpdated++;
    }
  }

  console.log(`✅ Profile synced across ${roomsUpdated} room(s)`);
  return roomsUpdated;
}

/**
 * Handler para el endpoint updateProfile
 */
function createUpdateProfileHandler(roomsManager, broadcastRoomState) {
  return async function updateProfileHandler(
    { username, name, avatarUrl },
    cb,
    socketId
  ) {
    console.log("📥 Received updateProfile request:", {
      username,
      name,
      hasAvatar: !!avatarUrl,
      avatarSizeKB: avatarUrl ? (avatarUrl.length / 1024).toFixed(2) : 0,
    });

    try {
      if (!username) {
        console.log("❌ updateProfile failed: Username is required");
        if (typeof cb === "function")
          cb({ ok: false, error: "Username is required" });
        return;
      }

      // Procesar avatar si existe
      const processedAvatarUrl = await processAvatar(avatarUrl);

      console.log("💾 Updating player profile in database...");
      // Usar el avatar procesado/comprimido
      const player = await statsService.ensurePlayer(
        username,
        name,
        processedAvatarUrl
      );
      console.log(
        `✅ Player profile updated: ${player.username} (Avatar: ${
          processedAvatarUrl
            ? (processedAvatarUrl.length / 1024).toFixed(1) + "KB"
            : "none"
        })`
      );

      // También actualizar en dataStore para la sesión actual
      try {
        dataStore.ensurePlayer(username, name, processedAvatarUrl);
        console.log("✅ Player profile updated in dataStore");
      } catch (e) {
        console.warn("⚠️ Error updating dataStore:", e);
      }

      // Sincronizar el perfil actualizado en todas las salas donde esté el jugador
      syncPlayerProfileAcrossRooms(
        roomsManager,
        socketId,
        username,
        player,
        broadcastRoomState
      );

      const response = {
        ok: true,
        player: {
          username: player.username,
          name: player.name,
          avatarUrl: player.avatarUrl, // Avatar final comprimido
          avatarId: player.avatarId,
        },
      };

      console.log(
        `📤 Sending updateProfile response (avatar: ${
          response.player.avatarUrl
            ? (response.player.avatarUrl.length / 1024).toFixed(1) + "KB"
            : "none"
        })`
      );
      if (typeof cb === "function") cb(response);
    } catch (e) {
      console.error("💥 Error updating profile:", e);
      const errorResponse = { ok: false, error: e.message };
      console.log("📤 Sending updateProfile error response:", errorResponse);
      if (typeof cb === "function") cb(errorResponse);
    }
  };
}

/**
 * Handler para comprimir todos los avatares existentes
 */
function createCompressAllAvatarsHandler() {
  return async function compressAllAvatarsHandler(data, cb) {
    console.log("🔧 Iniciando compresión masiva de avatares...");

    try {
      // Obtener todos los jugadores con avatares
      const players = await statsService.getAllPlayersWithAvatars();

      if (!players || players.length === 0) {
        console.log("ℹ️ No se encontraron jugadores con avatares");
        if (typeof cb === "function")
          cb({
            ok: true,
            message: "No hay avatares para comprimir",
            processed: 0,
          });
        return;
      }

      console.log(`📋 Encontrados ${players.length} jugadores con avatares`);

      let processed = 0;
      let compressed = 0;
      let skipped = 0;
      let errors = 0;

      for (const player of players) {
        try {
          if (!player.avatarUrl) {
            skipped++;
            continue;
          }

          const originalSizeKB = player.avatarUrl.length / 1024;
          console.log(
            `\n🔄 Procesando: ${player.username} (${originalSizeKB.toFixed(
              1
            )}KB)`
          );

          // Si ya es menor a 100KB, no comprimir
          if (originalSizeKB <= 100) {
            console.log(`   ✅ Ya optimizado, saltando`);
            skipped++;
            processed++;
            continue;
          }

          // Comprimir avatar
          const compressedAvatar = await compressAvatar(player.avatarUrl, 50);
          const newSizeKB = compressedAvatar.length / 1024;

          // Actualizar en base de datos
          await statsService.ensurePlayer(
            player.username,
            player.name,
            compressedAvatar
          );

          console.log(
            `   ✅ ${player.username}: ${originalSizeKB.toFixed(
              1
            )}KB → ${newSizeKB.toFixed(1)}KB`
          );
          compressed++;
          processed++;
        } catch (error) {
          console.error(
            `   ❌ Error procesando ${player.username}:`,
            error.message
          );
          errors++;
          processed++;
        }
      }

      const summary = {
        ok: true,
        message: "Compresión masiva completada",
        total: players.length,
        processed,
        compressed,
        skipped,
        errors,
      };

      console.log("\n📊 Resumen de compresión masiva:");
      console.log(`   - Total jugadores: ${summary.total}`);
      console.log(`   - Procesados: ${summary.processed}`);
      console.log(`   - Comprimidos: ${summary.compressed}`);
      console.log(`   - Saltados: ${summary.skipped}`);
      console.log(`   - Errores: ${summary.errors}`);

      if (typeof cb === "function") cb(summary);
    } catch (error) {
      console.error("💥 Error en compresión masiva:", error);
      if (typeof cb === "function")
        cb({
          ok: false,
          error: error.message,
        });
    }
  };
}

module.exports = {
  syncPlayerWithDatabase,
  processAvatar,
  syncPlayerProfileAcrossRooms,
  createUpdateProfileHandler,
  createCompressAllAvatarsHandler,
};
