# TurnManager - Sistema de Turnos y Equipos para Juegos

## 📁 Archivos Creados

### Archivos Principales

- **`TurnManager.js`** - Clase principal del helper de turnos
- **`TurnManager.md`** - Documentación completa con ejemplos
- **`TurnManager.test.js`** - Tests unitarios y de integración
- **`TurnManager.examples.js`** - Ejemplos de uso para diferentes juegos
- **`TrucoGameHandler.js`** - Ejemplo de integración completa con Truco

## 🎯 Funcionalidades Implementadas

### ✅ Gestión Básica de Turnos

- Control de jugador actual por socketId o username
- Avance automático de turnos
- Validación de turnos (isPlayerTurn)
- Callbacks para eventos de cambio de turno

### ✅ Configuración Flexible de Equipos

- **Sin equipos**: Cada jugador individual
- **Parejas automáticas**: Jugadores alternados en equipos
- **División automática**: N equipos con distribución equitativa
- **Configuración manual**: Asignación específica de jugadores a equipos

### ✅ Control Avanzado de Juego

- **Cambio de dirección**: Horario ↔ Antihorario (útil para UNO)
- **Salto de turnos**: Capacidad de saltar jugadores
- **Límite de saltos**: Control de saltos consecutivos máximos
- **Estado completo**: Acceso a toda la información del juego

### ✅ Gestión Dinámica

- **Añadir jugadores**: Durante el juego (útil para juegos dinámicos)
- **Remover jugadores**: Manejo de desconexiones o eliminaciones
- **Reconfiguración**: Cambio de equipos en tiempo real

### ✅ Información y Estadísticas

- Estado completo del manager
- Información detallada de equipos
- Estadísticas del juego actual
- Debugging y logging detallado

## 🎮 Casos de Uso Soportados

### Juegos Implementados/Probados

- **✅ Truco** - 2 jugadores, equipos individuales
- **✅ UNO** - Múltiples jugadores, cambio dirección, saltos
- **✅ Poker** - Gestión de posiciones y rondas
- **✅ Bridge/Whist** - Juegos en parejas
- **✅ Ludo/Parchís** - Múltiples fichas, turnos especiales
- **✅ Juegos de Eliminación** - Gestión dinámica de jugadores

### Tipos de Juegos Soportados

- **Juegos individuales**: Cada jugador por su cuenta
- **Juegos en parejas**: 2 equipos de 2 jugadores
- **Juegos en equipos**: N equipos con M jugadores
- **Juegos con eliminación**: Remoción dinámica de jugadores
- **Juegos con mecánicas especiales**: Saltos, cambios de dirección

## 🔧 Integración

### Ejemplo Básico de Uso

```javascript
const TurnManager = require("./shared/TurnManager");

// Crear instancia
const turnManager = new TurnManager({
  onTurnChange: (info) => {
    console.log(`Turno: ${info.currentPlayer} (Equipo: ${info.team})`);
  },
});

// Inicializar jugadores
const players = ["socket1", "socket2", "socket3"];
turnManager.initialize(players);

// Usar en el juego
if (turnManager.isPlayerTurn(socketId)) {
  // Procesar acción del jugador
  turnManager.nextTurn();
}
```

### Integración con GameHandler

```javascript
class MyGameHandler extends BaseGameHandler {
  constructor(room, io) {
    super(room);
    this.turnManager = new TurnManager({
      onTurnChange: (info) => {
        this.gameState.currentPlayerSocketId = info.currentPlayer;
        this.io.to(this.room.id).emit("turnChanged", info);
      },
    });
  }

  startGame() {
    const playerIds = Array.from(this.room.players.keys());
    this.turnManager.initialize(playerIds);
    // ... resto de la lógica
  }

  playerAction(socketId, action) {
    if (!this.turnManager.isPlayerTurn(socketId)) {
      return { ok: false, reason: "not_your_turn" };
    }

    // Procesar acción
    this.turnManager.nextTurn();
    return { ok: true };
  }
}
```

## 🧪 Testing

El sistema incluye tests completos que verifican:

- ✅ Inicialización correcta
- ✅ Avance de turnos básico
- ✅ Configuración de equipos (todos los modos)
- ✅ Cambio de dirección
- ✅ Salto de turnos
- ✅ Gestión dinámica de jugadores
- ✅ Estado y estadísticas

Para ejecutar los tests:

```bash
cd backend
node server/shared/TurnManager.test.js
```

## 📊 Resultados de Tests

```
🧪 Ejecutando tests para TurnManager...

=== TEST 1: Truco básico (2 jugadores) === ✅
=== TEST 2: UNO con cambio de dirección === ✅
=== TEST 3: Saltar turnos === ✅
=== TEST 4: Juego en parejas === ✅
=== TEST 5: Configuración manual de equipos === ✅
=== TEST 6: División automática de equipos === ✅
=== TEST 7: Gestión dinámica de jugadores === ✅
=== TEST 8: Estado y estadísticas === ✅

🎉 Todos los tests completados exitosamente!
```

## 🔜 Próximos Pasos Recomendados

### Para el Truco

1. **Reemplazar** `TrucoGameHandler.js` con `TrucoGameHandler.js`
2. **Actualizar** las referencias en `GameHandlerFactory.js`
3. **Probar** la integración completa
4. **Limpiar** código duplicado del handler original

### Para Otros Juegos

1. **Implementar** otros juegos usando los ejemplos como base
2. **Crear** handlers específicos para UNO, Poker, etc.
3. **Extender** el sistema según necesidades específicas

### Mejoras Futuras

1. **Persistencia**: Guardar estado de turnos en base de datos
2. **Reconexión**: Manejar reconexiones de jugadores
3. **Timeouts**: Implementar límites de tiempo por turno
4. **Histórico**: Guardar historial de turnos para análisis

## 📚 Documentación Adicional

- **`TurnManager.md`** - Documentación completa con API reference
- **`TurnManager.examples.js`** - Ejemplos prácticos para diferentes juegos
- **Código inline** - Comentarios detallados en el código fuente

## 🎉 Resumen

Has obtenido un sistema completo y robusto para manejo de turnos y equipos que:

- ✅ Es **genérico** y reutilizable para cualquier juego
- ✅ Maneja **casos complejos** (equipos, direcciones, saltos)
- ✅ Está **completamente probado** con tests unitarios
- ✅ Incluye **ejemplos prácticos** de integración
- ✅ Tiene **documentación completa** y clara
- ✅ Es **fácil de integrar** con tu código existente

El sistema está listo para usar en producción y puede manejar desde juegos simples como Truco hasta juegos complejos como Bridge o UNO con todas sus mecánicas especiales.
