// Manejador base para juegos
class BaseGameHandler {
  constructor(room) {
    this.room = room;
    this.gameState = this.createInitialState();
    room.gameState = this.gameState;
  }

  // Métodos abstractos que deben implementar los juegos específicos
  createInitialState() {
    throw new Error("createInitialState must be implemented by game handler");
  }

  startGame() {
    throw new Error("startGame must be implemented by game handler");
  }

  getPublicState() {
    throw new Error("getPublicState must be implemented by game handler");
  }

  // Nuevo método para obtener configuraciones específicas del juego
  getGameConfig() {
    throw new Error("getGameConfig must be implemented by game handler");
  }

  // Nuevo método para configurar parámetros específicos del juego
  setGameConfig(newConfig) {
    throw new Error("setGameConfig must be implemented by game handler");
  }

  // Nuevo método para obtener la configuración completa (sala + juego)
  getFullConfig() {
    return {
      ...this.room.config, // Configuración común de la sala
      ...this.getGameConfig(), // Configuración específica del juego
    };
  }

  // Métodos comunes
  isStarted() {
    return this.gameState.started || false;
  }

  isPaused() {
    return this.gameState.paused || false;
  }

  hasEnded() {
    return this.gameState.gameEnded || false;
  }
}

module.exports = BaseGameHandler;
