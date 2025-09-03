// Ejemplos de uso del TurnManager para diferentes juegos
const TurnManager = require("../shared/TurnManager");

/**
 * Ejemplo 1: UNO - Juego con cambio de dirección y saltos
 */
class UnoGameExample {
  constructor(playerIds) {
    this.turnManager = new TurnManager({
      onTurnChange: (turnInfo) => {
        console.log(`🎮 UNO: Turno de ${turnInfo.currentPlayer}`);
      },
      onDirectionChange: (direction) => {
        console.log(
          `🔄 UNO: Cambio de dirección ${direction === 1 ? "→" : "←"}`
        );
      },
      onPlayerSkipped: (skipped, next) => {
        console.log(`⏭️ UNO: ${skipped} pierde turno, ${next} juega`);
      },
    });

    // Inicializar sin equipos (cada jugador individual)
    this.turnManager.initialize(playerIds);
  }

  playCard(playerId, card) {
    if (!this.turnManager.isPlayerTurn(playerId)) {
      return { ok: false, reason: "No es tu turno" };
    }

    // Lógica específica del UNO
    if (card.type === "reverse") {
      this.turnManager.reverseDirection();
    } else if (card.type === "skip") {
      this.turnManager.setSkipNext(true);
    } else if (card.type === "draw_two") {
      this.turnManager.setSkipNext(true);
      // Lógica para hacer que el siguiente jugador robe 2 cartas
    }

    this.turnManager.nextTurn();
    return { ok: true };
  }
}

/**
 * Ejemplo 2: Poker - Gestión de rondas y posiciones
 */
class PokerGameExample {
  constructor(playerIds) {
    this.turnManager = new TurnManager({
      onTurnChange: (turnInfo) => {
        console.log(`🃏 Poker: Es turno de ${turnInfo.currentPlayer}`);
      },
    });

    // Inicializar sin equipos
    this.turnManager.initialize(playerIds);
    this.dealerPosition = 0;
    this.smallBlindPosition = 1;
    this.bigBlindPosition = 2;
  }

  startNewRound() {
    // Rotar posiciones
    this.dealerPosition =
      (this.dealerPosition + 1) % this.turnManager.players.length;
    this.smallBlindPosition =
      (this.smallBlindPosition + 1) % this.turnManager.players.length;
    this.bigBlindPosition =
      (this.bigBlindPosition + 1) % this.turnManager.players.length;

    // El primer jugador en actuar después de las ciegas
    const firstToAct =
      (this.bigBlindPosition + 1) % this.turnManager.players.length;
    this.turnManager.setCurrentPlayer(this.turnManager.players[firstToAct]);

    console.log(
      `🎰 Nueva ronda - Dealer: ${
        this.turnManager.players[this.dealerPosition]
      }`
    );
  }

  playerAction(playerId, action) {
    if (!this.turnManager.isPlayerTurn(playerId)) {
      return { ok: false, reason: "No es tu turno" };
    }

    console.log(`🎲 ${playerId} hace ${action}`);
    this.turnManager.nextTurn();
    return { ok: true };
  }
}

/**
 * Ejemplo 3: Juego en Parejas (Bridge/Whist)
 */
class PairsGameExample {
  constructor(playerIds) {
    this.turnManager = new TurnManager({
      onTurnChange: (turnInfo) => {
        const partner = this.getPartner(turnInfo.currentPlayer);
        console.log(
          `👥 Parejas: Turno de ${turnInfo.currentPlayer} (Equipo con ${partner})`
        );
      },
    });

    // Configurar parejas: jugadores 0,2 vs 1,3
    const teamConfig = {
      mode: "pairs",
    };

    this.turnManager.initialize(playerIds, teamConfig);
  }

  getPartner(playerId) {
    const team = this.turnManager.getPlayerTeam(playerId);
    const teamPlayers = this.turnManager.getTeamPlayers(team);
    return teamPlayers.find((p) => p !== playerId);
  }

  playCard(playerId, card) {
    if (!this.turnManager.isPlayerTurn(playerId)) {
      return { ok: false, reason: "No es tu turno" };
    }

    const partner = this.getPartner(playerId);
    console.log(`🃏 ${playerId} juega ${card} (Equipo con ${partner})`);

    this.turnManager.nextTurn();
    return { ok: true };
  }
}

/**
 * Ejemplo 4: Ludo/Parchís - Múltiples fichas por jugador
 */
class LudoGameExample {
  constructor(playerIds) {
    this.turnManager = new TurnManager({
      onTurnChange: (turnInfo) => {
        console.log(
          `🎲 Ludo: Es turno de ${turnInfo.currentPlayer} (Equipo ${turnInfo.team})`
        );
      },
    });

    // Cada jugador es su propio equipo
    this.turnManager.initialize(playerIds);
    this.playerPieces = new Map();

    // Inicializar fichas para cada jugador
    playerIds.forEach((playerId) => {
      this.playerPieces.set(playerId, [
        { id: `${playerId}_1`, position: 0 },
        { id: `${playerId}_2`, position: 0 },
        { id: `${playerId}_3`, position: 0 },
        { id: `${playerId}_4`, position: 0 },
      ]);
    });
  }

  rollDice(playerId) {
    if (!this.turnManager.isPlayerTurn(playerId)) {
      return { ok: false, reason: "No es tu turno" };
    }

    const diceValue = Math.floor(Math.random() * 6) + 1;
    console.log(`🎲 ${playerId} sacó ${diceValue}`);

    // Si saca 6, juega de nuevo; si no, pasa el turno
    if (diceValue !== 6) {
      this.turnManager.nextTurn();
    } else {
      console.log(`🎉 ${playerId} sacó 6, juega otra vez!`);
    }

    return { ok: true, diceValue };
  }

  movePiece(playerId, pieceId, spaces) {
    // Lógica para mover ficha
    const pieces = this.playerPieces.get(playerId);
    const piece = pieces.find((p) => p.id === pieceId);
    if (piece) {
      piece.position += spaces;
      console.log(`🏃 ${playerId} mueve ficha ${pieceId} ${spaces} espacios`);
    }
  }
}

/**
 * Ejemplo 5: Juego por Equipos con Eliminación
 */
class TeamEliminationExample {
  constructor(playerIds) {
    this.turnManager = new TurnManager({
      onTurnChange: (turnInfo) => {
        console.log(
          `⚔️ Guerra: Turno del equipo ${turnInfo.team} (${turnInfo.currentPlayer})`
        );
      },
    });

    // Dividir en 2 equipos automáticamente
    const teamConfig = {
      mode: "auto",
      teamsCount: 2,
    };

    this.turnManager.initialize(playerIds, teamConfig);
    this.eliminatedPlayers = new Set();
  }

  eliminatePlayer(playerId) {
    console.log(`💀 ${playerId} ha sido eliminado`);
    this.eliminatedPlayers.add(playerId);

    // Remover del turnManager
    this.turnManager.removePlayer(playerId);

    // Verificar si un equipo fue completamente eliminado
    this.checkTeamElimination();
  }

  checkTeamElimination() {
    const teamsInfo = this.turnManager.getTeamsInfo();
    for (const [teamId, info] of Object.entries(teamsInfo)) {
      if (info.playerCount === 0) {
        console.log(`🏆 Equipo ${teamId} eliminado! Game Over!`);
        return;
      }
    }
  }

  playerAttack(attackerId, targetId) {
    if (!this.turnManager.isPlayerTurn(attackerId)) {
      return { ok: false, reason: "No es tu turno" };
    }

    if (this.eliminatedPlayers.has(targetId)) {
      return { ok: false, reason: "Objetivo ya eliminado" };
    }

    console.log(`⚔️ ${attackerId} ataca a ${targetId}`);

    // Simular combate
    const success = Math.random() > 0.5;
    if (success) {
      this.eliminatePlayer(targetId);
    }

    this.turnManager.nextTurn();
    return { ok: true, success };
  }
}

// Función de demostración
function runGameExamples() {
  console.log("🎮 Ejemplos de uso del TurnManager para diferentes juegos\n");

  // Ejemplo UNO
  console.log("=== EJEMPLO UNO ===");
  const uno = new UnoGameExample(["Alice", "Bob", "Charlie"]);
  uno.playCard("Alice", { type: "number", value: 5 });
  uno.playCard("Bob", { type: "reverse" }); // Cambio de dirección
  uno.playCard("Charlie", { type: "skip" }); // Salto
  console.log();

  // Ejemplo Poker
  console.log("=== EJEMPLO POKER ===");
  const poker = new PokerGameExample([
    "Player1",
    "Player2",
    "Player3",
    "Player4",
  ]);
  poker.startNewRound();
  poker.playerAction("Player3", "call");
  poker.playerAction("Player4", "raise");
  console.log();

  // Ejemplo Parejas
  console.log("=== EJEMPLO PAREJAS ===");
  const pairs = new PairsGameExample(["North", "East", "South", "West"]);
  pairs.playCard("North", "Ace of Spades");
  pairs.playCard("East", "King of Hearts");
  console.log();

  // Ejemplo Ludo
  console.log("=== EJEMPLO LUDO ===");
  const ludo = new LudoGameExample(["Red", "Blue", "Yellow", "Green"]);
  ludo.rollDice("Red");
  ludo.rollDice("Blue");
  console.log();

  // Ejemplo Eliminación
  console.log("=== EJEMPLO ELIMINACIÓN ===");
  const war = new TeamEliminationExample(["A", "B", "C", "D"]);
  war.playerAttack("A", "B");
  war.playerAttack("C", "A");
  console.log();

  console.log("🏁 Ejemplos completados!");
}

// Exportar ejemplos
module.exports = {
  UnoGameExample,
  PokerGameExample,
  PairsGameExample,
  LudoGameExample,
  TeamEliminationExample,
  runGameExamples,
};

// Ejecutar si se llama directamente
if (require.main === module) {
  runGameExamples();
}
