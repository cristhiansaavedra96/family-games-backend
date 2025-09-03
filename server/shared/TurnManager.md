# TurnManager - Documentación y Ejemplos

## Descripción

`TurnManager` es un helper genérico para manejar turnos y equipos en cualquier juego que requiera control de turnos. Es especialmente útil para juegos como Truco, UNO, Poker, etc.

## Características

- ✅ Soporte para múltiples jugadores (socketIds o usernames)
- ✅ Configuración flexible de equipos (automática, manual, parejas, individual)
- ✅ Control de dirección de turnos (horario/antihorario)
- ✅ Capacidad de saltar turnos
- ✅ Callbacks para eventos (cambio de turno, dirección, jugador saltado)
- ✅ Métodos para añadir/remover jugadores dinámicamente
- ✅ Estadísticas y estado completo del juego

## Instalación/Uso

```javascript
const TurnManager = require("./shared/TurnManager");

// Crear una instancia
const turnManager = new TurnManager({
  maxSkips: 2, // Máximo saltos consecutivos
  onTurnChange: (turnInfo) => {
    console.log(
      `Cambio de turno: ${turnInfo.previousPlayer} -> ${turnInfo.currentPlayer}`
    );
  },
  onDirectionChange: (direction) => {
    console.log(
      `Dirección cambiada: ${direction === 1 ? "Horario" : "Antihorario"}`
    );
  },
  onPlayerSkipped: (skipped, next) => {
    console.log(`Jugador ${skipped} saltado, turno pasa a ${next}`);
  },
});
```

## Ejemplos de Uso

### Ejemplo 1: Truco (2 jugadores, cada uno su equipo)

```javascript
const players = ["socket1", "socket2"];

// Inicializar sin equipos (cada jugador es su propio equipo)
turnManager.initialize(players);

console.log("Jugador actual:", turnManager.getCurrentPlayer()); // 'socket1'
console.log("Equipo:", turnManager.getPlayerTeam("socket1")); // 0
console.log("Equipo:", turnManager.getPlayerTeam("socket2")); // 1

// Avanzar turno
const turnInfo = turnManager.nextTurn();
console.log("Nuevo jugador:", turnInfo.currentPlayer); // 'socket2'
```

### Ejemplo 2: UNO (4 jugadores, equipos individuales)

```javascript
const players = ["alice", "bob", "charlie", "diana"];

turnManager.initialize(players);

// Jugar varias rondas
turnManager.nextTurn(); // alice -> bob
turnManager.nextTurn(); // bob -> charlie

// ¡Cambiar dirección! (característica típica del UNO)
turnManager.reverseDirection();
turnManager.nextTurn(); // charlie -> bob (dirección invertida)

// Saltar siguiente jugador
turnManager.setSkipNext(true);
turnManager.nextTurn(); // bob -> alice (charlie saltado)
```

### Ejemplo 3: Juego en Parejas (4 jugadores, 2 equipos)

```javascript
const players = ["player1", "player2", "player3", "player4"];

// Configurar parejas automáticamente (jugadores alternados)
const teamConfig = {
  mode: "pairs", // player1 y player3 en equipo 0, player2 y player4 en equipo 1
};

turnManager.initialize(players, teamConfig);

console.log("Equipos:", turnManager.getTeamsInfo());
// {
//   0: { teamId: 0, players: ['player1', 'player3'], playerCount: 2 },
//   1: { teamId: 1, players: ['player2', 'player4'], playerCount: 2 }
// }
```

### Ejemplo 4: Configuración Manual de Equipos

```javascript
const players = ["socketA", "socketB", "socketC", "socketD"];

const teamConfig = {
  mode: "manual",
  assignments: {
    socketA: 0,
    socketB: 1,
    socketC: 0,
    socketD: 1,
  },
};

turnManager.initialize(players, teamConfig);

// Verificar equipos
console.log("SocketA equipo:", turnManager.getPlayerTeam("socketA")); // 0
console.log("SocketB equipo:", turnManager.getPlayerTeam("socketB")); // 1
```

### Ejemplo 5: División Automática en Equipos

```javascript
const players = ["p1", "p2", "p3", "p4", "p5", "p6"];

const teamConfig = {
  mode: "auto",
  teamsCount: 3, // Dividir en 3 equipos
};

turnManager.initialize(players, teamConfig);

console.log("Equipos:", turnManager.getTeamsInfo());
// Automáticamente dividirá los 6 jugadores en 3 equipos de 2 jugadores cada uno
```

## Integración con TrucoGameHandler

Ejemplo de cómo integrar con el sistema existente de Truco:

```javascript
class TrucoGameHandler extends BaseGameHandler {
  constructor(room, io) {
    super(room);
    this.io = io;

    // Crear TurnManager
    this.turnManager = new TurnManager({
      onTurnChange: (turnInfo) => {
        this.gameState.currentPlayerSocketId = turnInfo.currentPlayer;
        this.io.to(this.room.id).emit("turnChanged", turnInfo);
      },
    });
  }

  startGame() {
    const playerIds = this.getPlayerSocketIds();

    // Inicializar turnos (cada jugador su equipo en Truco 1v1)
    this.turnManager.initialize(playerIds);

    // Establecer el jugador inicial
    this.gameState.currentPlayerSocketId = this.turnManager.getCurrentPlayer();

    // ... resto de la lógica
  }

  playCard(socketId, cardId) {
    // Verificar si es el turno del jugador
    if (!this.turnManager.isPlayerTurn(socketId)) {
      return { ok: false, reason: "not_your_turn" };
    }

    // ... lógica de jugar carta

    // Avanzar turno automáticamente
    this.turnManager.nextTurn();

    return { ok: true };
  }

  getPlayerTeamBySocketId(socketId) {
    return this.turnManager.getPlayerTeam(socketId);
  }
}
```

## API Reference

### Constructor

- `new TurnManager(options)` - Crea una nueva instancia

### Métodos Principales

- `initialize(players, teamConfig)` - Inicializa con jugadores y equipos
- `getCurrentPlayer()` - Obtiene el jugador actual
- `nextTurn(options)` - Avanza al siguiente turno
- `isPlayerTurn(playerId)` - Verifica si es el turno de un jugador

### Control de Juego

- `reverseDirection()` - Cambia la dirección de turnos
- `setSkipNext(skip)` - Marca para saltar el siguiente turno
- `setCurrentPlayer(playerId)` - Establece el jugador actual

### Información de Equipos

- `getPlayerTeam(playerId)` - Obtiene el equipo de un jugador
- `getTeamPlayers(teamId)` - Obtiene jugadores de un equipo
- `getTeamsInfo()` - Información completa de equipos

### Gestión Dinámica

- `addPlayer(playerId, teamId)` - Añade un jugador
- `removePlayer(playerId)` - Remueve un jugador

### Estado y Estadísticas

- `getState()` - Estado completo del manager
- `getStats()` - Estadísticas del juego
- `reset()` - Reinicia el manager

## Configuraciones de Equipos

### Sin equipos (individual)

```javascript
turnManager.initialize(players); // Cada jugador es su propio equipo
```

### Parejas automáticas

```javascript
const teamConfig = { mode: "pairs" };
turnManager.initialize(players, teamConfig);
```

### División automática

```javascript
const teamConfig = { mode: "auto", teamsCount: 2 };
turnManager.initialize(players, teamConfig);
```

### Asignación manual

```javascript
const teamConfig = {
  mode: 'manual',
  assignments: { 'player1': 0, 'player2': 1, ... }
};
turnManager.initialize(players, teamConfig);
```

## Casos de Uso Comunes

- **Truco**: 2 jugadores, equipos individuales
- **UNO**: 2-8 jugadores, equipos individuales, cambio de dirección, saltos
- **Poker**: 2-10 jugadores, equipos individuales
- **Juegos en Parejas**: 4 jugadores, 2 equipos de 2
- **Juegos de Equipos**: N jugadores divididos en equipos

Este helper te permitirá manejar todos estos casos de uso de forma consistente y reutilizable.
