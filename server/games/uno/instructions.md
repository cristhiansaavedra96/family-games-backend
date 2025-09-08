# UNO (Implementación inicial)

Reglas implementadas:

- Colores: red, yellow, green, blue.
- Cartas numéricas 0-9 (0 una copia; 1-9 dos copias cada color).
- Acciones por color: skip, reverse, draw2 (dos copias cada una).
- Wild (elige color) x4, Wild Draw 4 x4.
- Orden de turno: horario inicialmente; reverse invierte dirección.
- Skip salta un jugador.
- Draw2 y Wild Draw4 acumulan (stacking) si el siguiente jugador responde con la misma carta.
  - Mientras haya `pendingDrawCount > 0`, solo se pueden jugar más cartas del mismo tipo para continuar la cadena.
  - Si el jugador no juega el mismo tipo, debe robar el total acumulado y pierde el turno.
- Wild y Wild Draw4 requieren elección de color (si no se recibe color se autoasigna aleatorio).

Condiciones de victoria:

- Cuando un jugador se queda sin cartas tras jugar, gana inmediatamente.

Pendiente / Futuro:

- Penalización por no decir "UNO" (no implementado).
- Desafío de Wild Draw4 (challenge) no implementado.
- Puntuación por cartas restantes no implementada.
- Límite de jugadores configurable.

Estado público esperado:

```
{
  gameKey: 'uno',
  started: boolean,
  currentPlayer: socketId,
  direction: 1|-1,
  topCard: { color, kind, value, id } | null,
  discardCount: number,
  drawCount: number,
  players: [ { id, handCount } ],
  pendingDrawCount: number,
  pendingDrawType: 'draw2' | 'wild_draw4' | null,
  winner: socketId|null
}
```

Acciones del handler:

- startGame()
- playCard(socketId, cardId, chosenColor?)
- drawCard(socketId)

Eventos a emitir (plan):

- state (reuse existente broadcastRoomState)
- turnChanged (cuando cambia jugador)
- cardPlayed (para animaciones futuras)
- playerDrew (robo de cartas acumuladas)
- winner
