const statsService = require("../services/statsService");

/**
 * Handler para obtener un avatar por ID (con optimización de caché)
 */
function createGetAvatarHandler() {
  return async function getAvatarHandler({ avatarId, clientHasCache }, cb) {
    console.log("📋 Received getAvatar request:", { avatarId, clientHasCache });

    try {
      if (!avatarId) {
        const error = { ok: false, error: "AvatarId is required" };
        if (typeof cb === "function") cb(error);
        else return error;
      }

      // Buscar jugador por avatarId en la base de datos
      const player = await statsService.getPlayerByAvatarId(avatarId);

      if (!player || !player.avatarUrl) {
        console.log("❌ Avatar not found:", avatarId);
        const error = { ok: false, error: "Avatar not found" };
        if (typeof cb === "function") cb(error);
        else return error;
      }

      // Si el cliente dice que ya tiene este avatar en caché, solo confirmar
      if (clientHasCache) {
        console.log(
          `✅ Client has cache for: ${player.username} -> ${avatarId} - SKIPPING TRANSFER`
        );
        const result = {
          ok: true,
          cached: true,
          avatar: {
            avatarId: player.avatarId,
            username: player.username,
            // NO enviar avatarUrl si ya está en caché
          },
        };
        if (typeof cb === "function") cb(result);
        else return result;
      }

      // Solo enviar el avatar completo si el cliente no lo tiene
      console.log(
        `📤 Sending avatar: ${player.username} -> ${avatarId} (${(
          player.avatarUrl.length / 1024
        ).toFixed(1)}KB)`
      );

      const result = {
        ok: true,
        avatar: {
          avatarId: player.avatarId,
          avatarUrl: player.avatarUrl, // Solo enviar si no está en caché
          username: player.username,
        },
      };
      if (typeof cb === "function") cb(result);
      else return result;
    } catch (e) {
      console.error("Error getting avatar:", e);
      const error = { ok: false, error: e.message };
      if (typeof cb === "function") cb(error);
      else return error;
    }
  };
}

/**
 * Handler para obtener avatar por ID (versión simple)
 */
function createGetAvatarByIdHandler() {
  return async function getAvatarByIdHandler({ avatarId }, cb) {
    try {
      const avatar = await statsService.getAvatarById(avatarId);
      const result = { ok: !!avatar, avatar };
      if (typeof cb === "function") cb(result);
      else return result;
    } catch (e) {
      console.error("Error getting avatar:", e);
      const error = { ok: false, error: e.message };
      if (typeof cb === "function") cb(error);
      else return error;
    }
  };
}

/**
 * Handler para sincronizar avatares
 */
function createSyncAvatarsHandler() {
  return async function syncAvatarsHandler({ lastSync }, cb) {
    try {
      const avatars = lastSync
        ? await statsService.getPlayersWithAvatarsUpdatedAfter(lastSync)
        : await statsService.getAllPlayersWithAvatars();
      const result = { ok: true, avatars };
      if (typeof cb === "function") cb(result);
      else return result;
    } catch (e) {
      console.error("Error syncing avatars:", e);
      const error = { ok: false, error: e.message };
      if (typeof cb === "function") cb(error);
      else return error;
    }
  };
}

/**
 * Handler para verificar múltiples avatares de una vez (batch)
 */
function createCheckAvatarsHandler() {
  return async function checkAvatarsHandler(
    { avatarIds, clientCachedIds },
    cb
  ) {
    console.log("📋 Batch avatar check:", {
      avatarIds: avatarIds.length,
      cached: clientCachedIds.length,
    });

    try {
      const results = [];

      for (const avatarId of avatarIds) {
        const player = await statsService.getPlayerByAvatarId(avatarId);

        if (player && player.avatarUrl) {
          const needsDownload = !clientCachedIds.includes(avatarId);

          results.push({
            avatarId,
            username: player.username,
            needsDownload,
            avatarUrl: needsDownload ? player.avatarUrl : undefined, // Solo incluir si necesita descarga
          });
        }
      }

      const result = { ok: true, results };
      if (typeof cb === "function") cb(result);
      else return result;
    } catch (e) {
      console.error("Error checking avatars:", e);
      const error = { ok: false, error: e.message };
      if (typeof cb === "function") cb(error);
      else return error;
    }
  };
}

module.exports = {
  createGetAvatarHandler,
  createGetAvatarByIdHandler,
  createSyncAvatarsHandler,
  createCheckAvatarsHandler,
};
