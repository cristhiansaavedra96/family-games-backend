// Sencillo DataStore en memoria con contrato para futura DB
const crypto = require('crypto');

// Generar hash único para avatar (para caché)
function generateAvatarId(avatarUrl) {
  if (!avatarUrl) return null;
  return crypto.createHash('md5').update(avatarUrl).digest('hex').substring(0, 16);
}

class InMemoryDataStore {
  constructor() {
    this.players = new Map(); // playerId -> { id, name, avatarUrl, avatarId, updatedAt }
  this.stats = new Map(); // playerId -> { totalGames, wins, points, pointsByGame: {}, gamesByGame: {}, winsByGame: {}, figures: {row,...} }
    this.sessions = []; // historial básico
  }

  ensurePlayer(id, name, avatarUrl) {
    const avatarId = generateAvatarId(avatarUrl);
    
    if (!this.players.has(id)) {
      this.players.set(id, { 
        id, 
        name, 
        avatarUrl, 
        avatarId,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    } else {
      const p = this.players.get(id);
      let updated = false;
      
      if (name && p.name !== name) {
        p.name = name;
        updated = true;
      }
      if (avatarUrl && p.avatarUrl !== avatarUrl) {
        p.avatarUrl = avatarUrl;
        p.avatarId = avatarId;
        updated = true;
      }
      
      if (updated) {
        p.updatedAt = Date.now();
      }
    }
    
    if (!this.stats.has(id)) {
      this.stats.set(id, { 
        totalGames: 0, 
        wins: 0, 
        points: 0, 
        pointsByGame: {}, 
        gamesByGame: {}, 
        winsByGame: {}, 
        figures: { corners: 0, row: 0, column: 0, diagonal: 0, border: 0, full: 0 } 
      });
    }
  }

  recordFigureClaim({ gameKey, roomId, playerId, figure }) {
    // Este método ya no se usa - las figuras se procesan al final del juego
    console.log('recordFigureClaim deprecated - use recordGameResult instead');
  }

  recordGameResult({ gameKey, roomId, winnerId, playersWithFigures }) {
    // Nuevo sistema de puntos del bingo
    const pointsMap = { column: 1, row: 1, diagonal: 1, corners: 2, border: 3, full: 5 };
    
    const ts = Date.now();
    this.sessions.push({ gameKey, roomId, ts, winnerId, playersWithFigures });
    
    for (const [playerId, figures] of Object.entries(playersWithFigures)) {
      if (!playerId || !figures) continue;
      
      this.ensurePlayer(playerId);
      const s = this.stats.get(playerId);
      
      // Calcular puntos totales para este jugador
      const totalPoints = figures.reduce((sum, figure) => sum + (pointsMap[figure] || 0), 0);
      const isWinner = playerId === winnerId;
      
      // Actualizar estadísticas
      s.totalGames += 1;
      if (isWinner) s.wins += 1;
      s.points += totalPoints;
      
      // Por juego
      s.gamesByGame[gameKey] = (s.gamesByGame[gameKey] || 0) + 1;
      s.pointsByGame[gameKey] = (s.pointsByGame[gameKey] || 0) + totalPoints;
      if (isWinner) s.winsByGame[gameKey] = (s.winsByGame[gameKey] || 0) + 1;
      
      // Registrar figuras completadas (para estadísticas)
      figures.forEach(figure => {
        s.figures[figure] = (s.figures[figure] || 0) + 1;
      });
    }
    
    console.log(`Game result recorded for ${gameKey} in room ${roomId}. Winner: ${winnerId}`);
  }

  getPlayerStats(id) { return this.stats.get(id) || null; }

  getLeaderboard(gameKey, limit) {
    const entries = [];
    for (const [playerId, s] of this.stats.entries()) {
      const points = (s.pointsByGame && s.pointsByGame[gameKey]) || 0;
      entries.push({ playerId, points });
    }
    entries.sort((a, b) => b.points - a.points);
    const sliced = typeof limit === 'number' ? entries.slice(0, Math.max(0, limit)) : entries;
    return sliced.map(({ playerId, points }) => {
      const p = this.players.get(playerId) || {};
      return { 
        id: playerId, 
        name: p.name, 
        avatarUrl: p.avatarUrl, 
        avatarId: p.avatarId,
        points 
      };
    });
  }

  // Nuevos métodos para sincronización de avatares
  getAvatarById(avatarId) {
    if (!avatarId) return null;
    for (const player of this.players.values()) {
      if (player.avatarId === avatarId) {
        return {
          username: player.id,
          name: player.name,
          avatarUrl: player.avatarUrl
        };
      }
    }
    return null;
  }

  getAllPlayersWithAvatars() {
    return Array.from(this.players.values()).map(p => ({
      username: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      avatarId: p.avatarId,
      updatedAt: p.updatedAt
    }));
  }
}

let store = null;
function getDataStore() {
  if (!store) store = new InMemoryDataStore();
  return store;
}

module.exports = { getDataStore };
