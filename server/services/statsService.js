// backend/server/services/statsService.js
// Servicio de stats y leaderboard usando Prisma

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

// Puntuación por figura del bingo
const pointsMap = { 
  column: 1, 
  row: 1, 
  diagonal: 1, 
  corners: 2, 
  border: 3, 
  full: 5 
};

// Generar hash único para avatar (para caché)
function generateAvatarId(avatarUrl) {
  if (!avatarUrl) return null;
  return crypto.createHash('md5').update(avatarUrl).digest('hex').substring(0, 16);
}

const statsService = {
  async ensurePlayer(username, name, avatarUrl) {
    if (!username) return;
    
    const avatarId = generateAvatarId(avatarUrl);
    
    const player = await prisma.player.upsert({
      where: { username },
      update: { 
        name, 
        avatarUrl, 
        avatarId,
        updatedAt: new Date()
      },
      create: { 
        username, 
        name, 
        avatarUrl, 
        avatarId 
      },
    });
    
    return player;
  },

  async getPlayerByUsername(username) {
    if (!username) return null;
    
    try {
      const player = await prisma.player.findUnique({
        where: { username }
      });
      
      return player;
    } catch (error) {
      console.error('Error getting player by username:', error);
      return null;
    }
  },

  async getPlayerByAvatarId(avatarId) {
    if (!avatarId) return null;
    
    try {
      const player = await prisma.player.findFirst({
        where: { avatarId }
      });
      
      return player;
    } catch (error) {
      console.error('Error getting player by avatarId:', error);
      return null;
    }
  },

  async recordFigureClaim({ gameKey, roomId, playerId, figure }) {
    // Este método ya no se usa - las figuras se procesan al final del juego
    console.log('recordFigureClaim deprecated - use recordGameResult instead');
  },

  async recordGameResult({ gameKey, roomId, winnerId, playersWithFigures }) {
    const ts = new Date();
    
    // playersWithFigures debe ser un objeto como:
    // { 'username1': ['column', 'row'], 'username2': ['diagonal', 'corners'], 'winner': ['full'] }
    
    for (const [username, figures] of Object.entries(playersWithFigures)) {
      if (!username || !figures) continue;
      
      // Calcular puntos totales para este jugador
      const totalPoints = figures.reduce((sum, figure) => sum + (pointsMap[figure] || 0), 0);
      const isWinner = username === winnerId;
      
      await prisma.playerGameStats.upsert({
        where: { playerUsername_gameKey: { playerUsername: username, gameKey } },
        update: {
          totalGames: { increment: 1 },
          wins: isWinner ? { increment: 1 } : undefined,
          points: { increment: totalPoints },
        },
        create: {
          playerUsername: username,
          gameKey,
          totalGames: 1,
          wins: isWinner ? 1 : 0,
          points: totalPoints,
        },
      });
    }
    
    console.log(`Game result recorded for ${gameKey} in room ${roomId}. Winner: ${winnerId}`);
  },

  async getPlayerStats(username, gameKey = 'bingo') {
    const stats = await prisma.playerGameStats.findUnique({
      where: { playerUsername_gameKey: { playerUsername: username, gameKey } },
  include: { Player: true }
    });
    
    if (!stats) {
      // Si no hay stats, crear entrada básica
      const player = await prisma.player.findUnique({ where: { username } });
      return {
        username,
        name: player?.name,
        avatarUrl: player?.avatarUrl,
        avatarId: player?.avatarId,
        totalGames: 0,
        wins: 0,
        points: 0,
        winRate: 0
      };
    }
    
    return {
      username: stats.playerUsername,
      name: stats.Player?.name,
      avatarUrl: stats.Player?.avatarUrl,
      avatarId: stats.Player?.avatarId,
      totalGames: stats.totalGames || 0,
      wins: stats.wins || 0,
      points: stats.points || 0,
      winRate: stats.totalGames > 0 ? ((stats.wins || 0) / stats.totalGames * 100).toFixed(1) : 0
    };
  },

  async getLeaderboard(gameKey = 'bingo', limit = 10) {
    const stats = await prisma.playerGameStats.findMany({
      where: { gameKey },
      orderBy: [
        { points: 'desc' },
        { wins: 'desc' },
        { totalGames: 'asc' }
      ],
      take: limit,
  include: { Player: true },
    });
    
    return stats.map((s, index) => ({
      rank: index + 1,
      username: s.playerUsername,
      name: s.Player?.name || s.playerUsername,
      avatarUrl: s.Player?.avatarUrl,
      avatarId: s.Player?.avatarId,
      points: s.points || 0,
      wins: s.wins || 0,
      totalGames: s.totalGames || 0,
      winRate: s.totalGames > 0 ? ((s.wins || 0) / s.totalGames * 100).toFixed(1) : 0,
      updatedAt: s.Player?.updatedAt
    }));
  },

  // Nuevo método para obtener avatar por ID (caché)
  async getAvatarById(avatarId) {
    if (!avatarId) return null;
    const player = await prisma.player.findFirst({
      where: { avatarId },
      select: { avatarUrl: true, username: true, name: true }
    });
    return player;
  },

  // Nuevo método para obtener todos los jugadores con sus avatarIds
  async getAllPlayersWithAvatars() {
    const players = await prisma.player.findMany({
      select: { 
        username: true, 
        name: true, 
        avatarUrl: true, 
        avatarId: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' }
    });
    return players;
  },

  // Obtener jugadores por fecha de avatar (para sincronización)
  async getPlayersWithAvatarsUpdatedAfter(lastSync) {
    const players = await prisma.player.findMany({
      where: {
        updatedAt: { gt: new Date(lastSync) },
        avatarUrl: { not: null }
      },
      select: { 
        username: true, 
        name: true, 
        avatarUrl: true, 
        avatarId: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' }
    });
    return players;
  },

  // Top jugadores por diferentes criterios
  async getTopPlayers(gameKey = 'bingo', criteria = 'points', limit = 10) {
    const orderBy = {};
    switch (criteria) {
      case 'wins':
        orderBy.wins = 'desc';
        break;
      case 'games':
        orderBy.totalGames = 'desc';
        break;
      case 'winrate':
        // Para win rate, ordenar por wins/totalGames usando raw query si es necesario
        orderBy.wins = 'desc';
        break;
      default:
        orderBy.points = 'desc';
    }

    const stats = await prisma.playerGameStats.findMany({
      where: { 
        gameKey,
        totalGames: { gt: 0 } // Solo jugadores que han jugado al menos una vez
      },
      orderBy: [orderBy, { totalGames: 'desc' }],
      take: limit,
  include: { Player: true },
    });
    console.log('[getTopPlayers] Resultados de la consulta playerGameStats:', stats);
    return stats.map((s, index) => ({
      rank: index + 1,
      username: s.playerUsername,
      name: s.Player?.name || s.playerUsername,
      avatarUrl: s.Player?.avatarUrl,
      avatarId: s.Player?.avatarId,
      points: s.points || 0,
      wins: s.wins || 0,
      totalGames: s.totalGames || 0,
      winRate: s.totalGames > 0 ? ((s.wins || 0) / s.totalGames * 100).toFixed(1) : 0
    }));
  },

  // Buscar jugador por username o nombre
  async searchPlayers(query, limit = 10) {
    const players = await prisma.player.findMany({
      where: {
        OR: [
          { username: { contains: query } },
          { name: { contains: query } }
        ]
      },
      select: {
        username: true,
        name: true,
        avatarUrl: true,
        avatarId: true,
        createdAt: true,
        stats: {
          select: {
            gameKey: true,
            points: true,
            wins: true,
            totalGames: true
          }
        }
      },
      take: limit,
      orderBy: { createdAt: 'desc' }
    });
    
    return players.map(p => ({
      username: p.username,
      name: p.name,
      avatarUrl: p.avatarUrl,
      avatarId: p.avatarId,
      totalStats: p.stats.reduce((acc, stat) => ({
        points: acc.points + (stat.points || 0),
        wins: acc.wins + (stat.wins || 0),
        games: acc.games + (stat.totalGames || 0)
      }), { points: 0, wins: 0, games: 0 })
    }));
  },
};

module.exports = statsService;
