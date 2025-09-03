/**
 * TurnManager - Helper genérico para manejo de turnos y equipos
 * Sirve para cualquier juego que requiera control de turnos por equipos
 */
class TurnManager {
  constructor(options = {}) {
    this.players = []; // Array de socketIds o usernames
    this.teams = new Map(); // Map: playerId -> teamId
    this.teamPlayers = new Map(); // Map: teamId -> [playerIds]
    this.currentPlayerIndex = 0;
    this.direction = 1; // 1 = sentido horario, -1 = antihorario
    this.skipNext = false; // Para saltar el siguiente turno
    this.maxSkips = options.maxSkips || 1; // Máximo de saltos consecutivos
    this.currentSkips = 0;

    // Callbacks opcionales para eventos
    this.onTurnChange = options.onTurnChange || null;
    this.onDirectionChange = options.onDirectionChange || null;
    this.onPlayerSkipped = options.onPlayerSkipped || null;
  }

  /**
   * Inicializa el manager con una lista de jugadores
   * @param {Array} players - Array de socketIds o usernames
   * @param {Object} teamConfig - Configuración de equipos (opcional)
   */
  initialize(players, teamConfig = null) {
    if (!Array.isArray(players) || players.length === 0) {
      throw new Error("Se requiere un array de jugadores no vacío");
    }

    this.players = [...players];
    this.currentPlayerIndex = 0;
    this.direction = 1;
    this.skipNext = false;
    this.currentSkips = 0;

    // Configurar equipos
    this.setupTeams(teamConfig);

    console.log(
      `🎯 TurnManager inicializado con ${this.players.length} jugadores`
    );
    console.log(`🎯 Equipos configurados:`, this.getTeamsInfo());

    return this;
  }

  /**
   * Configura los equipos según la configuración proporcionada
   * @param {Object} teamConfig - Configuración de equipos
   */
  setupTeams(teamConfig) {
    this.teams.clear();
    this.teamPlayers.clear();

    if (!teamConfig) {
      // Sin equipos: cada jugador es su propio equipo
      this.players.forEach((playerId, index) => {
        this.teams.set(playerId, index);
        this.teamPlayers.set(index, [playerId]);
      });
      return;
    }

    if (teamConfig.mode === "auto") {
      // Modo automático: dividir jugadores en equipos iguales
      const teamsCount = teamConfig.teamsCount || 2;
      const playersPerTeam = Math.ceil(this.players.length / teamsCount);

      this.players.forEach((playerId, index) => {
        const teamId = Math.floor(index / playersPerTeam);
        this.teams.set(playerId, teamId);

        if (!this.teamPlayers.has(teamId)) {
          this.teamPlayers.set(teamId, []);
        }
        this.teamPlayers.get(teamId).push(playerId);
      });
    } else if (teamConfig.mode === "manual" && teamConfig.assignments) {
      // Modo manual: asignaciones específicas
      for (const [playerId, teamId] of Object.entries(teamConfig.assignments)) {
        if (this.players.includes(playerId)) {
          this.teams.set(playerId, teamId);

          if (!this.teamPlayers.has(teamId)) {
            this.teamPlayers.set(teamId, []);
          }
          this.teamPlayers.get(teamId).push(playerId);
        }
      }
    } else if (teamConfig.mode === "pairs") {
      // Modo parejas: jugadores alternados en equipos
      this.players.forEach((playerId, index) => {
        const teamId = index % 2;
        this.teams.set(playerId, teamId);

        if (!this.teamPlayers.has(teamId)) {
          this.teamPlayers.set(teamId, []);
        }
        this.teamPlayers.get(teamId).push(playerId);
      });
    }
  }

  /**
   * Obtiene el jugador actual
   * @returns {string} El socketId o username del jugador actual
   */
  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  /**
   * Obtiene el índice del jugador actual
   * @returns {number} Índice del jugador actual
   */
  getCurrentPlayerIndex() {
    return this.currentPlayerIndex;
  }

  /**
   * Obtiene el equipo de un jugador
   * @param {string} playerId - socketId o username del jugador
   * @returns {number|null} ID del equipo o null si no se encuentra
   */
  getPlayerTeam(playerId) {
    return this.teams.get(playerId) || null;
  }

  /**
   * Obtiene todos los jugadores de un equipo
   * @param {number} teamId - ID del equipo
   * @returns {Array} Array de playerIds del equipo
   */
  getTeamPlayers(teamId) {
    return this.teamPlayers.get(teamId) || [];
  }

  /**
   * Obtiene el siguiente jugador sin avanzar el turno
   * @returns {string} El socketId o username del siguiente jugador
   */
  getNextPlayer() {
    const nextIndex = this.getNextPlayerIndex();
    return this.players[nextIndex];
  }

  /**
   * Obtiene el índice del siguiente jugador
   * @returns {number} Índice del siguiente jugador
   */
  getNextPlayerIndex() {
    let nextIndex = this.currentPlayerIndex + this.direction;

    // Manejar wraparound
    if (nextIndex >= this.players.length) {
      nextIndex = 0;
    } else if (nextIndex < 0) {
      nextIndex = this.players.length - 1;
    }

    return nextIndex;
  }

  /**
   * Avanza al siguiente turno
   * @param {Object} options - Opciones para el avance
   * @returns {Object} Información del nuevo turno
   */
  nextTurn(options = {}) {
    const previousPlayer = this.getCurrentPlayer();
    const previousIndex = this.currentPlayerIndex;

    // Verificar si hay que saltar este turno
    if (this.skipNext && this.currentSkips < this.maxSkips) {
      this.currentSkips++;
      const skippedPlayer = this.getCurrentPlayer();

      // Avanzar al siguiente
      this.currentPlayerIndex = this.getNextPlayerIndex();
      this.skipNext = false;

      // Callback de jugador saltado
      if (this.onPlayerSkipped) {
        this.onPlayerSkipped(skippedPlayer, this.getCurrentPlayer());
      }

      console.log(
        `🚫 Turno saltado: ${skippedPlayer} -> ${this.getCurrentPlayer()}`
      );
    } else {
      // Turno normal
      this.currentPlayerIndex = this.getNextPlayerIndex();
      this.currentSkips = 0;
    }

    const newPlayer = this.getCurrentPlayer();
    const turnInfo = {
      previousPlayer,
      previousIndex,
      currentPlayer: newPlayer,
      currentIndex: this.currentPlayerIndex,
      direction: this.direction,
      team: this.getPlayerTeam(newPlayer),
      turnNumber: options.turnNumber || 1,
    };

    // Callback de cambio de turno
    if (this.onTurnChange) {
      this.onTurnChange(turnInfo);
    }

    console.log(
      `🎯 Turno avanzado: ${previousPlayer} -> ${newPlayer} (Equipo: ${turnInfo.team})`
    );

    return turnInfo;
  }

  /**
   * Cambia la dirección de los turnos
   * @returns {number} Nueva dirección (1 o -1)
   */
  reverseDirection() {
    this.direction = this.direction === 1 ? -1 : 1;

    // Callback de cambio de dirección
    if (this.onDirectionChange) {
      this.onDirectionChange(this.direction);
    }

    console.log(
      `🔄 Dirección cambiada: ${
        this.direction === 1 ? "Horario" : "Antihorario"
      }`
    );

    return this.direction;
  }

  /**
   * Marca que el siguiente jugador debe saltar su turno
   * @param {boolean} skip - Si debe saltarse el siguiente turno
   */
  setSkipNext(skip = true) {
    this.skipNext = skip;
    console.log(`⏭️ Skip siguiente turno: ${skip}`);
  }

  /**
   * Establece el jugador actual por su ID
   * @param {string} playerId - socketId o username del jugador
   * @returns {boolean} true si se pudo establecer, false si no se encontró
   */
  setCurrentPlayer(playerId) {
    const index = this.players.indexOf(playerId);
    if (index === -1) {
      console.log(
        `❌ No se pudo establecer jugador actual: ${playerId} no encontrado`
      );
      return false;
    }

    this.currentPlayerIndex = index;
    console.log(`🎯 Jugador actual establecido: ${playerId} (índice ${index})`);
    return true;
  }

  /**
   * Verifica si es el turno de un jugador específico
   * @param {string} playerId - socketId o username del jugador
   * @returns {boolean} true si es su turno
   */
  isPlayerTurn(playerId) {
    return this.getCurrentPlayer() === playerId;
  }

  /**
   * Obtiene información completa de los equipos
   * @returns {Object} Información de todos los equipos
   */
  getTeamsInfo() {
    const info = {};
    for (const [teamId, players] of this.teamPlayers) {
      info[teamId] = {
        teamId,
        players: [...players],
        playerCount: players.length,
      };
    }
    return info;
  }

  /**
   * Obtiene el estado completo del manager
   * @returns {Object} Estado completo
   */
  getState() {
    return {
      players: [...this.players],
      currentPlayer: this.getCurrentPlayer(),
      currentPlayerIndex: this.currentPlayerIndex,
      direction: this.direction,
      skipNext: this.skipNext,
      currentSkips: this.currentSkips,
      maxSkips: this.maxSkips,
      teams: this.getTeamsInfo(),
    };
  }

  /**
   * Obtiene estadísticas del juego
   * @returns {Object} Estadísticas
   */
  getStats() {
    return {
      totalPlayers: this.players.length,
      totalTeams: this.teamPlayers.size,
      currentRound:
        Math.floor(this.currentPlayerIndex / this.players.length) + 1,
      direction: this.direction === 1 ? "clockwise" : "counterclockwise",
    };
  }

  /**
   * Reinicia el manager manteniendo la configuración
   */
  reset() {
    this.currentPlayerIndex = 0;
    this.direction = 1;
    this.skipNext = false;
    this.currentSkips = 0;

    console.log(`🔄 TurnManager reiniciado`);
  }

  /**
   * Añade un jugador al juego (útil para juegos dinámicos)
   * @param {string} playerId - socketId o username del nuevo jugador
   * @param {number} teamId - ID del equipo (opcional)
   * @returns {boolean} true si se añadió correctamente
   */
  addPlayer(playerId, teamId = null) {
    if (this.players.includes(playerId)) {
      console.log(`❌ El jugador ${playerId} ya existe`);
      return false;
    }

    this.players.push(playerId);

    // Asignar equipo
    if (teamId !== null) {
      this.teams.set(playerId, teamId);
      if (!this.teamPlayers.has(teamId)) {
        this.teamPlayers.set(teamId, []);
      }
      this.teamPlayers.get(teamId).push(playerId);
    } else {
      // Asignar al siguiente equipo disponible o crear uno nuevo
      const newTeamId = this.teamPlayers.size;
      this.teams.set(playerId, newTeamId);
      this.teamPlayers.set(newTeamId, [playerId]);
    }

    console.log(
      `✅ Jugador añadido: ${playerId} (Equipo: ${this.getPlayerTeam(
        playerId
      )})`
    );
    return true;
  }

  /**
   * Remueve un jugador del juego
   * @param {string} playerId - socketId o username del jugador a remover
   * @returns {boolean} true si se removió correctamente
   */
  removePlayer(playerId) {
    const playerIndex = this.players.indexOf(playerId);
    if (playerIndex === -1) {
      console.log(`❌ El jugador ${playerId} no existe`);
      return false;
    }

    // Remover de la lista de jugadores
    this.players.splice(playerIndex, 1);

    // Remover de equipos
    const teamId = this.teams.get(playerId);
    if (teamId !== undefined) {
      this.teams.delete(playerId);
      const teamPlayers = this.teamPlayers.get(teamId);
      if (teamPlayers) {
        const teamPlayerIndex = teamPlayers.indexOf(playerId);
        if (teamPlayerIndex !== -1) {
          teamPlayers.splice(teamPlayerIndex, 1);

          // Si el equipo queda vacío, eliminarlo
          if (teamPlayers.length === 0) {
            this.teamPlayers.delete(teamId);
          }
        }
      }
    }

    // Ajustar índice actual si es necesario
    if (this.currentPlayerIndex >= this.players.length) {
      this.currentPlayerIndex = 0;
    } else if (playerIndex <= this.currentPlayerIndex) {
      this.currentPlayerIndex = Math.max(0, this.currentPlayerIndex - 1);
    }

    console.log(`✅ Jugador removido: ${playerId}`);
    return true;
  }
}

module.exports = TurnManager;
