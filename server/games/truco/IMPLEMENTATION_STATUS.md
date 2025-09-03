# Truco Uruguayo - Implementación Backend

## ✅ Estructura Creada

### Archivos implementados:

- `backend/server/games/truco/index.js` - Módulo principal
- `backend/server/games/truco/logic.js` - Lógica del juego y reglas
- `backend/server/games/truco/TrucoGameHandler.js` - Handler principal del juego
- `backend/server/games/truco/instructions.md` - Documentación completa de reglas

### Integraciones realizadas:

- ✅ `GameHandlerFactory.js` - Agregado soporte para "truco"
- ✅ `socketHandlers.js` - Agregados validGameKeys y handlers específicos

## 🎮 Funcionalidades Implementadas

### Lógica del Juego:

- ✅ **Mazo de 40 cartas** (sin 8 y 9)
- ✅ **Sistema de jerarquías** con piezas, matas, alcahuete
- ✅ **Cálculo de envido** con reglas especiales para piezas
- ✅ **Detección de flor** con 3 tipos diferentes
- ✅ **Comparación de cartas** dinámicamente según muestra
- ✅ **Soporte 2 y 4 jugadores** (equipos automáticos)

### Reglas específicas 2vs2 (4 jugadores):

- ✅ **Envido**: Se compara entre los 4 jugadores, gana el mejor individualmente
- ✅ **Rondas de truco**: Se comparan las cartas de los 4 jugadores
- ✅ **Puntos por equipo**: El ganador individual suma para su equipo
- ✅ **Flor automática**: Cada jugador con flor aporta 3 puntos automáticamente
- ✅ **Verificación de victoria**: Se verifica después de flores automáticas

### Game Handler:

- ✅ **Inicialización del juego** con reparto y muestra
- ✅ **Estados del juego** (dealing, envido, playing, finished)
- ✅ **Jugada de cartas** con validaciones
- ✅ **Resolución de rondas** y manos
- ✅ **Sistema de puntuación** por equipos
- ✅ **Manejo de envido** (declarar, responder, resolver)

### Socket Handlers:

- ✅ **playCard** - Jugar una carta
- ✅ **envido** - Cantar envido/real envido/falta envido
- ✅ **envidoResponse** - Aceptar/rechazar envido
- ✅ **skipEnvido** - No querer envido (pasar)

## 🚀 Cómo probar

### 1. Crear sala de Truco:

```javascript
socket.emit("createRoom", {
  player: { name: "Jugador1", avatarUrl: "..." },
  gameKey: "truco",
});
```

### 2. Configurar jugadores (2 o 4):

```javascript
socket.emit("configureGame", {
  roomId: "room_id",
  playerCount: 2, // o 4
});
```

### 3. Iniciar juego:

```javascript
socket.emit("startGame", { roomId: "room_id" });
```

### 4. Jugar cartas:

```javascript
socket.emit("playCard", {
  roomId: "room_id",
  cardId: "1-espada",
});
```

### 5. Cantar envido:

```javascript
socket.emit("envido", {
  roomId: "room_id",
  type: "envido", // 'real_envido', 'falta_envido'
});
```

## 📡 Eventos del Cliente

### Eventos recibidos:

- `gameStarted` - Juego iniciado
- `privateHand` - Cartas privadas + envido + flor
- `cardPlayed` - Carta jugada por alguien
- `roundFinished` - Ronda terminada
- `handFinished` - Mano terminada
- `envidoDeclared` - Envido cantado
- `envidoResponse` - Respuesta al envido
- `envidoResolved` - Envido resuelto
- `envidoSkipped` - Envido pasado
- `florDeclared` - Flor automática declarada
- `gameOver` - Juego terminado

### Eventos enviados:

- `playCardResult` - Resultado de jugar carta
- `envidoResult` - Resultado de cantar envido
- `envidoResponseResult` - Resultado de responder envido
- `skipEnvidoResult` - Resultado de pasar envido

## 🔄 Estados del Juego

1. **dealing** - Repartiendo cartas
2. **envido** - Fase de envido (al inicio)
3. **playing** - Jugando cartas
4. **finished** - Juego terminado

## 🏆 Sistema de Puntuación

- **Mano ganada**: 1 punto (por ahora)
- **Envido**: 2 puntos
- **Real envido**: 3 puntos
- **Falta envido**: 15 puntos (simplificado)
- **Flor**: 4 puntos (pendiente implementar)
- **Truco**: 2-4 puntos (pendiente implementar)

## 🔮 Próximas implementaciones

### Pendientes:

- [ ] Manejo de truco/retruco/vale cuatro
- [ ] Sistema completo de flor/contraflor
- [ ] Cálculo correcto de falta envido
- [ ] Manejo de abandono de partida
- [ ] Estadísticas específicas del truco
- [ ] Validaciones avanzadas
- [ ] Sistema de chat durante el juego
- [ ] Replay de partidas

### Mejoras sugeridas:

- [ ] Timeout para jugadas (30 segundos)
- [ ] Animaciones en tiempo real
- [ ] Sistema de ranking
- [ ] Torneos
- [ ] Espectadores
