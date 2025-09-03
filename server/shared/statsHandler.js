const statsService = require("../services/statsService");
const { getDataStore } = require("../core/datastore");

const dataStore = getDataStore();

/**
 * Handler para obtener estadísticas de un jugador
 * @param {object} roomsManager - Gestor de salas
 * @param {string} socketId - ID del socket
 * @param {string} roomId - ID de la sala actual
 */
function createGetStatsHandler(roomsManager) {
  return async function getStatsHandler({ playerId }, cb, socketId, roomId) {
    try {
      // usar username prioritariamente si está asociado al jugador en sala
      const room = roomsManager.getRoom(roomId);
      const p = room?.players.get(socketId);
      const username = playerId || p?.username;

      if (username) {
        // Usar Prisma/statsService para datos persistentes
        const stats = await statsService.getPlayerStats(username, "bingo");
        if (typeof cb === "function") cb({ ok: true, stats });
        else return { ok: true, stats };
      } else {
        // Fallback a dataStore si no hay username
        const stats = dataStore.getPlayerStats(socketId) || {
          totalGames: 0,
          wins: 0,
          points: 0,
        };
        if (typeof cb === "function") cb({ ok: true, stats });
        else return { ok: true, stats };
      }
    } catch (e) {
      console.error("Error getting stats:", e);
      const error = { ok: false, error: e.message };
      if (typeof cb === "function") cb(error);
      else return error;
    }
  };
}

/**
 * Handler para obtener el leaderboard de un juego
 */
function createGetLeaderboardHandler() {
  return async function getLeaderboardHandler({ gameKey, limit }, cb) {
    try {
      const leaderboard = await statsService.getLeaderboard(
        gameKey || "bingo",
        limit || 10
      );
      const result = { ok: true, leaderboard };
      if (typeof cb === "function") cb(result);
      else return result;
    } catch (e) {
      console.error("Error getting leaderboard:", e);
      const error = { ok: false, error: e.message };
      if (typeof cb === "function") cb(error);
      else return error;
    }
  };
}

/**
 * Handler para obtener top jugadores por diferentes criterios
 */
function createGetTopPlayersHandler() {
  return async function getTopPlayersHandler(params, cb) {
    console.log("[getTopPlayers] Solicitud recibida:", params);
    try {
      const { gameKey, criteria, limit } = params || {};
      const topPlayers = await statsService.getTopPlayers(
        gameKey || "bingo",
        criteria || "points",
        limit || 10
      );
      console.log("[getTopPlayers] Respuesta enviada:", topPlayers);
      const result = { ok: true, topPlayers };
      if (typeof cb === "function") cb(result);
      else return result;
    } catch (e) {
      console.error("Error getting top players:", e);
      const error = { ok: false, error: e.message };
      if (typeof cb === "function") cb(error);
      else return error;
    }
  };
}

/**
 * Handler para buscar jugadores por query
 */
function createSearchPlayersHandler() {
  return async function searchPlayersHandler({ query, limit }, cb) {
    try {
      const players = await statsService.searchPlayers(query, limit || 10);
      const result = { ok: true, players };
      if (typeof cb === "function") cb(result);
      else return result;
    } catch (e) {
      console.error("Error searching players:", e);
      const error = { ok: false, error: e.message };
      if (typeof cb === "function") cb(error);
      else return error;
    }
  };
}

module.exports = {
  createGetStatsHandler,
  createGetLeaderboardHandler,
  createGetTopPlayersHandler,
  createSearchPlayersHandler,
};
