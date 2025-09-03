// Tests para TurnManager
const TurnManager = require("../shared/TurnManager");

function runTests() {
  console.log("🧪 Ejecutando tests para TurnManager...\n");

  // Test 1: Truco básico (2 jugadores)
  console.log("=== TEST 1: Truco básico (2 jugadores) ===");
  const trucoTest = new TurnManager();
  const trucoPlayers = ["socket1", "socket2"];

  trucoTest.initialize(trucoPlayers);

  console.log("Jugador inicial:", trucoTest.getCurrentPlayer()); // socket1
  console.log("Equipo socket1:", trucoTest.getPlayerTeam("socket1")); // 0
  console.log("Equipo socket2:", trucoTest.getPlayerTeam("socket2")); // 1

  // Avanzar algunos turnos
  let turn1 = trucoTest.nextTurn();
  console.log("Turno 1:", turn1.currentPlayer); // socket2

  let turn2 = trucoTest.nextTurn();
  console.log("Turno 2:", turn2.currentPlayer); // socket1

  console.log("✅ Test Truco básico completado\n");

  // Test 2: UNO con cambio de dirección
  console.log("=== TEST 2: UNO con cambio de dirección ===");
  const unoTest = new TurnManager({
    onDirectionChange: (direction) => {
      console.log(
        `🔄 Dirección cambiada: ${direction === 1 ? "Horario" : "Antihorario"}`
      );
    },
  });

  const unoPlayers = ["alice", "bob", "charlie", "diana"];
  unoTest.initialize(unoPlayers);

  console.log("Jugadores:", unoPlayers);
  console.log("Jugador inicial:", unoTest.getCurrentPlayer()); // alice

  // Jugar normalmente
  console.log("Turno 1:", unoTest.nextTurn().currentPlayer); // bob
  console.log("Turno 2:", unoTest.nextTurn().currentPlayer); // charlie

  // ¡Cambiar dirección!
  unoTest.reverseDirection();
  console.log(
    "Turno 3 (dirección cambiada):",
    unoTest.nextTurn().currentPlayer
  ); // bob
  console.log("Turno 4:", unoTest.nextTurn().currentPlayer); // alice

  console.log("✅ Test UNO completado\n");

  // Test 3: Saltar turnos
  console.log("=== TEST 3: Saltar turnos ===");
  const skipTest = new TurnManager({
    onPlayerSkipped: (skipped, next) => {
      console.log(`⏭️ Jugador ${skipped} saltado, turno pasa a ${next}`);
    },
  });

  skipTest.initialize(["p1", "p2", "p3"]);

  console.log("Jugador inicial:", skipTest.getCurrentPlayer()); // p1
  skipTest.nextTurn(); // -> p2

  // Saltar el siguiente turno
  skipTest.setSkipNext(true);
  console.log("Turno con skip:", skipTest.nextTurn().currentPlayer); // p1 (p3 saltado)

  console.log("✅ Test Skip completado\n");

  // Test 4: Juego en parejas
  console.log("=== TEST 4: Juego en parejas ===");
  const teamTest = new TurnManager();
  const teamPlayers = ["player1", "player2", "player3", "player4"];

  const teamConfig = {
    mode: "pairs", // player1 y player3 en equipo 0, player2 y player4 en equipo 1
  };

  teamTest.initialize(teamPlayers, teamConfig);

  console.log("Equipos:", teamTest.getTeamsInfo());
  console.log("Equipo de player1:", teamTest.getPlayerTeam("player1")); // 0
  console.log("Equipo de player2:", teamTest.getPlayerTeam("player2")); // 1
  console.log("Equipo de player3:", teamTest.getPlayerTeam("player3")); // 0
  console.log("Equipo de player4:", teamTest.getPlayerTeam("player4")); // 1

  console.log("✅ Test Parejas completado\n");

  // Test 5: Configuración manual
  console.log("=== TEST 5: Configuración manual de equipos ===");
  const manualTest = new TurnManager();
  const manualPlayers = ["socketA", "socketB", "socketC", "socketD"];

  const manualConfig = {
    mode: "manual",
    assignments: {
      socketA: 0,
      socketB: 1,
      socketC: 0,
      socketD: 1,
    },
  };

  manualTest.initialize(manualPlayers, manualConfig);

  console.log("Equipos manuales:", manualTest.getTeamsInfo());
  console.log("✅ Test Manual completado\n");

  // Test 6: División automática
  console.log("=== TEST 6: División automática de equipos ===");
  const autoTest = new TurnManager();
  const autoPlayers = ["p1", "p2", "p3", "p4", "p5", "p6"];

  const autoConfig = {
    mode: "auto",
    teamsCount: 3, // 3 equipos de 2 jugadores cada uno
  };

  autoTest.initialize(autoPlayers, autoConfig);

  console.log("Equipos automáticos:", autoTest.getTeamsInfo());
  console.log("✅ Test Automático completado\n");

  // Test 7: Gestión dinámica de jugadores
  console.log("=== TEST 7: Gestión dinámica de jugadores ===");
  const dynamicTest = new TurnManager();
  dynamicTest.initialize(["player1", "player2"]);

  console.log("Estado inicial:", dynamicTest.getState().players);

  // Añadir jugador
  dynamicTest.addPlayer("player3", 0); // Al equipo 0
  console.log("Después de añadir player3:", dynamicTest.getState().players);
  console.log("Equipos:", dynamicTest.getTeamsInfo());

  // Remover jugador
  dynamicTest.removePlayer("player2");
  console.log("Después de remover player2:", dynamicTest.getState().players);
  console.log("Jugador actual:", dynamicTest.getCurrentPlayer());

  console.log("✅ Test Dinámico completado\n");

  // Test 8: Estado completo
  console.log("=== TEST 8: Estado y estadísticas ===");
  const stateTest = new TurnManager();
  stateTest.initialize(["a", "b", "c", "d"]);

  console.log("Estado completo:", stateTest.getState());
  console.log("Estadísticas:", stateTest.getStats());

  console.log("✅ Test Estado completado\n");

  console.log("🎉 Todos los tests completados exitosamente!");
}

// Ejecutar los tests
if (require.main === module) {
  runTests();
}

module.exports = runTests;
