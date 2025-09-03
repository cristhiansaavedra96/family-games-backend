// Lógica del Truco Uruguayo

// ======= MAZO Y CARTAS =======
function createDeck() {
  const suits = ["espada", "basto", "oro", "copa"];
  const values = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12]; // Sin 8 y 9

  const deck = [];
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ value, suit, id: `${value}-${suit}` });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function dealCards(deck, playerCount) {
  const hands = Array.from({ length: playerCount }, () => []);
  let cardIndex = 0;

  // Cada jugador recibe 3 cartas
  for (let round = 0; round < 3; round++) {
    for (let player = 0; player < playerCount; player++) {
      hands[player].push(deck[cardIndex]);
      cardIndex++;
    }
  }

  // La siguiente carta es la muestra
  const muestra = deck[cardIndex];

  return { hands, muestra };
}

// ======= JERARQUÍA Y COMPARACIÓN DE CARTAS =======
function isPieza(card, muestra) {
  if (card.suit !== muestra.suit) return false;
  return [2, 4, 5, 11, 10].includes(card.value);
}

function isAlcahuete(card, muestra) {
  return (
    card.value === 12 &&
    card.suit === muestra.suit &&
    [2, 4, 5, 11, 10].includes(muestra.value)
  );
}

function isMata(card) {
  const matas = [
    { value: 1, suit: "espada" },
    { value: 1, suit: "basto" },
    { value: 7, suit: "espada" },
    { value: 7, suit: "oro" },
  ];

  return matas.some(
    (mata) => mata.value === card.value && mata.suit === card.suit
  );
}

function getCardHierarchy(card, muestra) {
  // Piezas (más fuertes)
  if (isPieza(card, muestra)) {
    const piezaValues = { 2: 30, 4: 29, 5: 28, 11: 27, 10: 27 };
    return {
      category: "pieza",
      strength: 100 + piezaValues[card.value],
      envidoValue: piezaValues[card.value],
    };
  }

  // Alcahuete (toma el valor de la muestra si es pieza)
  if (isAlcahuete(card, muestra)) {
    const piezaValues = { 2: 30, 4: 29, 5: 28, 11: 27, 10: 27 };
    return {
      category: "alcahuete",
      strength: 100 + piezaValues[muestra.value],
      envidoValue: piezaValues[muestra.value],
    };
  }

  // Matas
  if (isMata(card)) {
    const mataStrength = {
      "1-espada": 96,
      "1-basto": 95,
      "7-espada": 94,
      "7-oro": 93,
    };
    return {
      category: "mata",
      strength: mataStrength[card.id],
      envidoValue: card.value === 7 ? 7 : card.value,
    };
  }

  // Cartas comunes
  const commonOrder = [3, 2, 1, 12, 11, 10, 7, 6, 5, 4];
  const position = commonOrder.indexOf(card.value);
  const strength = position >= 0 ? 50 - position : 0;

  return {
    category: "common",
    strength,
    // Para envido: 12, 11 y 10 valen 0; el resto vale su número
    envidoValue: card.value >= 10 ? 0 : card.value,
  };
}

function compareCards(card1, card2, muestra) {
  const hierarchy1 = getCardHierarchy(card1, muestra);
  const hierarchy2 = getCardHierarchy(card2, muestra);

  // Mayor strength gana
  if (hierarchy1.strength > hierarchy2.strength) return 1;
  if (hierarchy1.strength < hierarchy2.strength) return -1;
  return 0; // Empate (parda)
}

// ======= ENVIDO =======
function calculateEnvido(hand, muestra) {
  if (!Array.isArray(hand) || hand.length === 0 || !muestra) return 0;

  // Helper: valor de envido por carta según reglas
  const piezaValues = { 2: 30, 4: 29, 5: 28, 11: 27, 10: 27 };
  const isPiece = (c) =>
    c.suit === muestra.suit && piezaValues[c.value] != null;
  const isAlca = (c) =>
    c.suit === muestra.suit &&
    c.value === 12 &&
    piezaValues[muestra.value] != null;
  const envidoVal = (c) => {
    if (isPiece(c)) return piezaValues[c.value];
    if (isAlca(c)) return piezaValues[muestra.value];
    return c.value >= 10 ? 0 : c.value; // 12,11,10 valen 0; 7..1 valen su número
  };

  // Caso 1: Si hay al menos una pieza (o alcahuete), se usa: pieza + mejor liga (una sola)
  const pieces = hand.filter((c) => isPiece(c) || isAlca(c));
  if (pieces.length > 0) {
    // Mejor pieza (mayor valor de envido de pieza)
    const bestPieceVal = Math.max(...pieces.map((p) => envidoVal(p)));
    // Liga: entre las cartas NO pieza/alcahuete, tomar el mayor valor (o 0 si ninguna)
    const ligaCandidates = hand.filter((c) => !isPiece(c) && !isAlca(c));
    const bestLiga = ligaCandidates.length
      ? Math.max(...ligaCandidates.map((c) => envidoVal(c)))
      : 0;
    return bestPieceVal + bestLiga;
  }

  // Caso 2: Sin piezas: si hay 2 cartas del mismo palo, 20 + suma de las 2 de mayor valor en ese palo
  const cardsBySuit = hand.reduce((acc, c) => {
    (acc[c.suit] = acc[c.suit] || []).push(c);
    return acc;
  }, {});

  let maxEnvido = 0;
  for (const cards of Object.values(cardsBySuit)) {
    if (cards.length >= 2) {
      const vals = cards.map(envidoVal).sort((a, b) => b - a);
      const total = 20 + vals[0] + vals[1];
      if (total > maxEnvido) maxEnvido = total;
    }
  }

  // Caso 3: Sin piezas y sin dos del mismo palo: tomar la carta de mayor valor (7 la más alta)
  if (maxEnvido === 0) {
    maxEnvido = Math.max(...hand.map(envidoVal));
  }

  return maxEnvido;
}

// ======= FLOR =======
function hasFlor(hand, muestra) {
  if (!Array.isArray(hand) || hand.length === 0 || !muestra) {
    return { hasFlor: false };
  }

  // Contar piezas (EXCLUYE alcahuete para flor según regla del usuario)
  const isPiece = (card) => isPieza(card, muestra);
  const isAlca = (card) => isAlcahuete(card, muestra);
  const pieces = hand.filter(isPiece);

  // Conteo por palo
  const suitCounts = hand.reduce((acc, c) => {
    acc[c.suit] = (acc[c.suit] || 0) + 1;
    return acc;
  }, {});

  // Regla 3: 3 cartas del mismo palo
  for (const [suit, count] of Object.entries(suitCounts)) {
    if (count === 3) {
      return { hasFlor: true, type: "tres_mismo_palo", suit };
    }
  }

  // Regla 1: Tengo 2 piezas (del palo de la muestra)
  if (pieces.length >= 2) {
    return { hasFlor: true, type: "piezas", suit: muestra.suit };
  }

  // Regla 2: 1 pieza y las otras dos cartas del mismo palo (cualquier palo)
  if (pieces.length === 1) {
    // Las "otras dos" no deben ser piezas ni alcahuete
    const others = hand.filter((c) => !isPiece(c) && !isAlca(c));
    if (others.length === 2 && others[0].suit === others[1].suit) {
      return { hasFlor: true, type: "pieza_mismo_palo", suit: others[0].suit };
    }
  }

  return { hasFlor: false };
}

// ======= UTILIDADES =======
function createInitialGameState(playerCount) {
  // Para 2 jugadores: cada jugador es su propio equipo
  // Para 4 jugadores: equipos 0 y 1, con jugadores [0,2] vs [1,3]
  const teams =
    playerCount === 4
      ? [
          { id: 0, players: [0, 2] }, // Equipo 0: jugadores 0 y 2
          { id: 1, players: [1, 3] }, // Equipo 1: jugadores 1 y 3
        ]
      : [
          { id: 0, players: [0] }, // Equipo 0: jugador 0
          { id: 1, players: [1] }, // Equipo 1: jugador 1
        ];

  return {
    players: playerCount,
    teams: teams,
    teamCount: teams.length, // Para referencia rápida
    currentDealer: 0,
    currentPlayer: 0,
    round: 1, // Ronda dentro de la mano (1, 2, 3)
    hand: 1, // Mano actual
    deck: [],
    muestra: null,
    playerHands: [],
    playedCards: [], // Cartas jugadas en la ronda actual
    roundWinners: [], // Ganadores de cada ronda
    scores: [0, 0], // Puntajes por equipo (siempre 2 equipos)
    gamePhase: "first_turn", // first_turn, playing, finished
    trucoState: {
      level: 0, // 0=no truco, 1=truco, 2=retruco, 3=vale4
      declarer: null,
      declarerTeam: null,
      accepted: false,
      teamWithWord: null, // Qué equipo tiene la "palabra" para subir
      pendingResponse: false,
    },
    envidoState: {
      active: false,
      type: null, // envido, real_envido, falta_envido
      declarer: null,
      responses: new Map(),
    },
    florState: {
      active: false,
      declarations: new Map(),
    },
  };
}

function getPlayerTeam(playerId, teams) {
  // Buscar en qué equipo está el jugador
  for (let i = 0; i < teams.length; i++) {
    if (teams[i].players.includes(playerId)) {
      return i;
    }
  }
  // Fallback para compatibilidad (no debería llegar aquí)
  return playerId % 2;
}

function getNextPlayer(currentPlayer, playerCount) {
  console.log(
    `🔍 [Backend] getNextPlayer - currentPlayer: ${currentPlayer} (type: ${typeof currentPlayer}), playerCount: ${playerCount} (type: ${typeof playerCount})`
  );
  const result = (currentPlayer + 1) % playerCount;
  console.log(`🔍 [Backend] getNextPlayer result: ${result}`);
  return result;
}

module.exports = {
  createDeck,
  shuffleDeck,
  dealCards,
  isPieza,
  isAlcahuete,
  isMata,
  getCardHierarchy,
  compareCards,
  calculateEnvido,
  hasFlor,
  createInitialGameState,
  getPlayerTeam,
  getNextPlayer,
};
