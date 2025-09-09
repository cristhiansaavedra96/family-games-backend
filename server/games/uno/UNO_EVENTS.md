# Eventos de UNO - Sistema de Reclamos

## Nuevos Eventos Implementados

### `unoClaimWindowOpen`

**Descripción**: Se emite cuando un jugador queda con 1 carta y transcurre el período de gracia sin que declare UNO.

**Cuándo se emite**: 2 segundos después de que un jugador quede con 1 carta (si no ha declarado UNO).

**Datos enviados**:

```javascript
{
  playerId: "socket-id-del-jugador",
  playerName: "Nombre del jugador",
  gracePeriodMs: 2000
}
```

**Frontend**: El ActionBar escucha este evento y muestra el botón "Acusar".

---

### `unoClaimWindowClosed`

**Descripción**: Se emite cuando se cierra la ventana de reclamo de UNO.

**Cuándo se emite**:

- Cuando el jugador declara UNO (`reason: "declared"`)
- Cuando otro jugador lo reclama/acusa (`reason: "claimed"`)
- Cuando el jugador roba más cartas (`reason: "more_cards"`)

**Datos enviados**:

```javascript
{
  playerId: "socket-id-del-jugador",
  reason: "declared" | "claimed" | "more_cards"
}
```

**Frontend**: El ActionBar escucha este evento y oculta el botón "Acusar".

---

## Flujo del Sistema

1. **Jugador queda con 1 carta** → `updateUnoStateFor()` se ejecuta
2. **Se inicia timer de 2s** → Período de gracia para declarar UNO
3. **Si NO declara UNO** → Se emite `unoClaimWindowOpen`
4. **Frontend muestra botón** → "Acusar" aparece para otros jugadores
5. **Acción tomada**:
   - Si declara UNO → `unoClaimWindowClosed` con `reason: "declared"`
   - Si es reclamado → `unoClaimWindowClosed` con `reason: "claimed"`
   - Si roba más cartas → `unoClaimWindowClosed` con `reason: "more_cards"`

## Ventajas

✅ **Sin polling**: Eliminado el `socket.emit("getState")` cada 300ms
✅ **Reactivo**: UI responde inmediatamente a eventos
✅ **Eficiente**: Solo se envían datos cuando hay cambios
✅ **Escalable**: Funciona con cualquier número de jugadores
✅ **Limpio**: Timers se cancelan automáticamente

## Compatibilidad

- ✅ Mantiene compatibilidad con eventos existentes (`playerAtUno`, `unoDeclared`, `unoCalledOut`)
- ✅ No rompe funcionalidad actual
- ✅ Mejora la eficiencia sin cambios disruptivos
