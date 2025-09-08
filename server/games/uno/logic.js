// Lógica y utilidades para el juego UNO
// Simplificación: valores 0-9, acciones: skip, reverse, draw2, wild, wild_draw4
// Colores: red, yellow, green, blue

const COLORS = ["red", "yellow", "green", "blue"]; // sin color para wild

function buildDeck() {
  const deck = [];
  // Números
  COLORS.forEach((color) => {
    // Un 0 por color
    deck.push(makeCard(color, "number", 0));
    // Dos de cada 1-9
    for (let v = 1; v <= 9; v++) {
      deck.push(makeCard(color, "number", v));
      deck.push(makeCard(color, "number", v));
    }
    // Acciones: skip, reverse, draw2 (dos copias cada uno)
    ["skip", "reverse", "draw2"].forEach((type) => {
      deck.push(makeCard(color, type));
      deck.push(makeCard(color, type));
    });
  });
  // Wilds
  for (let i = 0; i < 4; i++) deck.push(makeCard(null, "wild"));
  for (let i = 0; i < 4; i++) deck.push(makeCard(null, "wild_draw4"));
  return deck;
}

let _nextId = 1;
function makeCard(color, kind, value = null) {
  return {
    id: `c${_nextId++}`,
    color, // null para wilds
    kind, // number | skip | reverse | draw2 | wild | wild_draw4
    value, // número 0-9 cuando kind === 'number'
  };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function initialGameState() {
  return {
    started: false,
    gameEnded: false,
    players: [], // socketIds en orden de turno
    hands: {}, // socketId -> array de cartas
    drawPile: [],
    discardPile: [],
    currentColor: null, // color vigente (importante tras wild)
    currentValue: null, // valor vigente (para números)
    currentKind: null, // kind vigente (para acciones/números)
    currentPlayer: null, // socketId
    direction: 1, // 1 horario, -1 antihorario
    pendingDrawCount: 0, // acumulado por stacking
    pendingDrawType: null, // 'draw2' o 'wild_draw4' mientras haya stacking
    winner: null,
    // Sistema de puntos
    scores: {}, // socketId -> puntos acumulados
    eliminatedPlayers: new Set(), // jugadores eliminados por alcanzar el límite
    roundWinner: null, // ganador de la ronda actual
  };
}

function dealInitialHands(state, playerIds, handSize = 7) {
  playerIds.forEach((pid) => {
    state.hands[pid] = [];
    for (let i = 0; i < handSize; i++) {
      drawOne(state, pid);
    }
  });
}

function drawOne(state, pid) {
  if (state.drawPile.length === 0) {
    reshuffleFromDiscard(state);
  }
  const card = state.drawPile.pop();
  if (card) state.hands[pid].push(card);
  return card;
}

function reshuffleFromDiscard(state) {
  if (state.discardPile.length <= 1) return; // no suficiente
  const top = state.discardPile[state.discardPile.length - 1];
  const rest = state.discardPile.slice(0, -1);
  state.discardPile = [top];
  shuffle(rest);
  state.drawPile = rest.concat(state.drawPile);
}

function topDiscard(state) {
  return state.discardPile[state.discardPile.length - 1] || null;
}

function canPlayCard(state, card, pid) {
  // Stacking activo: solo puedes jugar misma cadena
  if (state.pendingDrawCount > 0) {
    if (state.pendingDrawType === "draw2" && card.kind === "draw2") return true;
    if (state.pendingDrawType === "wild_draw4" && card.kind === "wild_draw4")
      return true;
    return false; // no se puede jugar otra cosa
  }
  // Wild siempre se puede
  if (card.kind === "wild" || card.kind === "wild_draw4") return true;
  // Comparar con color, número o tipo
  if (card.color && card.color === state.currentColor) return true;
  if (card.kind === state.currentKind && card.kind !== "number") return true;
  if (card.kind === "number" && card.value === state.currentValue) return true;
  return false;
}

function applyCardEffects(state, card, chosenColor = null) {
  // Actualizar color/kind/value base
  if (card.kind === "wild" || card.kind === "wild_draw4") {
    state.currentColor = chosenColor || randomColor();
    state.currentKind = card.kind;
    state.currentValue = null;
  } else {
    state.currentColor = card.color;
    state.currentKind = card.kind;
    state.currentValue = card.kind === "number" ? card.value : null;
  }

  // Efectos
  switch (card.kind) {
    case "skip":
      return { skipNext: 1 };
    case "reverse":
      state.direction *= -1;
      return { reversed: true };
    case "draw2":
      state.pendingDrawType = "draw2";
      state.pendingDrawCount += 2;
      return { stacked: state.pendingDrawCount };
    case "wild_draw4":
      state.pendingDrawType = "wild_draw4";
      state.pendingDrawCount += 4;
      return { stacked: state.pendingDrawCount };
    default:
      return {};
  }
}

function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

// Calcular puntos de una mano de cartas
function calculateHandPoints(hand) {
  return hand.reduce((total, card) => {
    if (card.kind === "number") {
      return total + card.value;
    } else if (["skip", "reverse", "draw2"].includes(card.kind)) {
      return total + 20;
    } else if (["wild", "wild_draw4"].includes(card.kind)) {
      return total + 50;
    }
    return total;
  }, 0);
}

module.exports = {
  COLORS,
  buildDeck,
  shuffle,
  initialGameState,
  dealInitialHands,
  drawOne,
  reshuffleFromDiscard,
  topDiscard,
  canPlayCard,
  applyCardEffects,
  randomColor,
  calculateHandPoints,
};
