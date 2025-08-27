// Servidor Node.js + Socket.IO - Sala única, sorteo auto 1s/0.5s, voz manejada en frontend
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const { shuffleBag, generateCard, checkFigures } = require('./games/bingo');
const { getDataStore } = require('./core/datastore');
const statsService = require('./services/statsService');
const dataStore = getDataStore();

dotenv.config();

const PORT = process.env.PORT || 4000;
const ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(cors({ origin: ORIGIN }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGIN } });

// Soporte de múltiples salas
const rooms = new Map(); // roomId -> state
let roomCounter = 1;

// Función para encontrar el número de sala más bajo disponible
function getAvailableRoomNumber() {
  let roomNumber = 1;
  while (true) {
    const roomId = String(roomNumber);
    if (!rooms.has(roomId)) {
      return roomNumber;
    }
    roomNumber++;
  }
}

// Función para encontrar el jugador más antiguo (por joinedAt)
function getOldestPlayer(room) {
  if (room.players.size === 0) return null;
  
  let oldestPlayerId = null;
  let oldestJoinTime = Infinity;
  
  for (const [playerId, playerData] of room.players) {
    if (playerData.joinedAt < oldestJoinTime) {
      oldestJoinTime = playerData.joinedAt;
      oldestPlayerId = playerId;
    }
  }
  
  return oldestPlayerId;
}

function createRoom() {
  const roomNumber = getAvailableRoomNumber();
  const id = String(roomNumber);
  const room = {
    id,
    name: `Sala ${roomNumber}`,
    gameKey: 'bingo', // preparado para múltiples juegos
    started: false,
    paused: true,
    speed: 1, // multiplicador x0.5..x2
    cardsPerPlayer: 1, // Siempre inicializar en 1
    players: new Map(), // socketId -> { name, avatarUrl, avatarId, username, cards: number[][] }
    hostId: null,
    bag: [],
    drawn: [],
    timer: null,
    announceTimeout: null,
    figuresClaimed: { 
      // Cambio a estructura más detallada: figura -> { playerId, cardIndex, details }
      corners: null, 
      row: null, 
      column: null, 
      diagonal: null, 
      border: null, 
      full: null 
    },
    // Nueva estructura para figuras específicas por jugador y cartón
    specificClaims: new Map(), // "playerId:cardIndex:figure" -> { playerId, cardIndex, figure, details }
    // Rastreo de figuras completadas por jugador para estadísticas finales
    playerFigures: new Map(), // playerId -> Set(['column', 'row', 'diagonal'])
    // Nuevos campos para sistema de nueva partida
    gameEnded: false,
    playersReady: new Set(), // Set de socketIds listos para nueva partida
    announcementQueue: [], // Cola de anuncios individuales
    processingAnnouncements: false,
  };
  rooms.set(id, room);
  return room;
}

function getRoomsList() {
  return Array.from(rooms.values()).map(r => ({
    id: r.id,
    name: r.name,
    players: Array.from(r.players.entries()).map(([sid, p]) => ({ 
      id: sid, 
      name: p.name, 
      avatarId: p.avatarId, // Solo enviar avatarId para caché eficiente
      username: p.username 
    })),
    started: r.started,
    hostId: r.hostId,
    cardsPerPlayer: r.cardsPerPlayer || 1,
  }));
}

function broadcastRoomsList() {
  io.emit('rooms', getRoomsList());
}

function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const publicPlayers = Array.from(room.players.entries()).map(([sid, p]) => ({
    id: sid,
    name: p.name,
    avatarUrl: p.avatarUrl,
    avatarId: p.avatarId, // ✅ Incluir avatarId
    username: p.username,
    cards: p.cards,
  }));
  io.to(roomId).emit('state', {
    roomId,
    name: room.name,
  gameKey: room.gameKey,
    started: room.started,
    paused: room.paused,
    speed: room.speed,
    cardsPerPlayer: room.cardsPerPlayer,
    hostId: room.hostId,
    players: publicPlayers,
    drawn: room.drawn,
    lastBall: room.drawn[room.drawn.length - 1] || null,
    figuresClaimed: room.figuresClaimed,
    specificClaims: Object.fromEntries(room.specificClaims), // Convertir Map a Object para JSON
    gameEnded: room.gameEnded,
    playersReady: Array.from(room.playersReady),
  });
}

function stopTimer(room) { if (room.timer) { clearInterval(room.timer); room.timer = null; } }
function startTimerIfNeeded(room) {
  if (!room.started || room.paused || room.timer) return;
  const baseMs = 7500;
  const factor = Number(room.speed) || 1;
  const intervalMs = Math.max(500, Math.round(baseMs / factor));
  room.timer = setInterval(() => drawNextBall(room), intervalMs);
}

function drawNextBall(room) {
  if (!room.started || room.paused) return;
  const n = room.bag.pop();
  if (n == null) return;
  room.drawn.push(n);
  io.to(room.id).emit('ball', n);
  broadcastRoomState(room.id);
}

function startGame(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.started = true;
  room.paused = false;
  room.gameEnded = false;
  room.playersReady.clear();
  room.announcementQueue = [];
  room.processingAnnouncements = false;
  // reiniciar velocidad por si quedó algo previo
  room.speed = room.speed || 1;
  room.bag = shuffleBag();
  room.drawn = [];
  room.figuresClaimed = { corners: null, row: null, column: null, diagonal: null, border: null, full: null };
  room.playerFigures.clear(); // Limpiar figuras rastreadas del juego anterior
  for (const p of room.players.values()) {
    p.cards = Array.from({ length: room.cardsPerPlayer }, () => generateCard());
  }
  broadcastRoomState(roomId);
  stopTimer(room);
  startTimerIfNeeded(room);
}

// Procesar cola de anuncios individuales
function processAnnouncementQueue(room) {
  if (room.processingAnnouncements || room.announcementQueue.length === 0) return;
  
  room.processingAnnouncements = true;
  const announcement = room.announcementQueue.shift();
  
  // Pausar el juego durante el anuncio
  room.paused = true;
  stopTimer(room);
  
  // Enviar anuncio individual
  io.to(room.id).emit('announcement', announcement);
  
  // Programar siguiente anuncio o reanudar juego
  setTimeout(() => {
    room.processingAnnouncements = false;
    
    if (room.announcementQueue.length > 0) {
      // Continuar con el siguiente anuncio
      processAnnouncementQueue(room);
    } else {
      // No hay más anuncios, reanudar juego si no terminó
      if (!room.gameEnded) {
        room.paused = false;
        startTimerIfNeeded(room);
        broadcastRoomState(room.id);
      }
    }
  }, 2500); // 2.5 segundos por anuncio
}

function validateAndFlags(roomId, socketId, cardIndex, markedFromClient) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, reason: 'room_not_found' };
  const player = room.players.get(socketId);
  if (!player) return { ok: false, reason: 'player_not_found' };
  const card = player.cards?.[cardIndex];
  if (!card) return { ok: false, reason: 'card_not_found' };
  // Validar matriz marcada enviada: sólo permite marcar números ya cantados o centro libre
  let marked = markedFromClient;
  if (!Array.isArray(marked) || marked.length !== 5 || marked.some(row => !Array.isArray(row) || row.length !== 5)) {
    return { ok: false, reason: 'invalid_marked' };
  }
  const drawnSet = new Set(room.drawn);
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const isCenter = r === 2 && c === 2;
      if (isCenter) {
        // centro siempre puede estar marcado
        if (!marked[r][c]) marked[r][c] = true;
        continue;
      }
      if (marked[r][c]) {
        const value = card[r][c];
        if (!drawnSet.has(value)) {
          return { ok: false, reason: 'marked_not_drawn' };
        }
      }
    }
  }
  const flags = checkFigures(marked);
  return { ok: true, flags };
}

// Construye detalles de la figura para resaltar celdas exactas
function buildClaimDetails(figure, marked) {
  const details = {};
  if (!marked) return details;
  switch (figure) {
    case 'row': {
      for (let r = 0; r < 5; r++) {
        if (marked[r].every(Boolean)) { details.row = r; break; }
      }
      break;
    }
    case 'column': {
      for (let c = 0; c < 5; c++) {
        if ([0,1,2,3,4].every(i => marked[i][c])) { details.column = c; break; }
      }
      break;
    }
    case 'diagonal': {
      const d1 = [0,1,2,3,4].every(i => marked[i][i]);
      const d2 = [0,1,2,3,4].every(i => marked[i][4-i]);
      if (d1) details.diagonal = 0; else if (d2) details.diagonal = 1;
      break;
    }
    case 'border': {
      details.border = true;
      break;
    }
    case 'corners': {
      details.corners = true;
      break;
    }
    case 'full': {
      details.full = true;
      break;
    }
  }
  return details;
}

async function checkClaim(roomId, socketId, figure, cardIndex, markedFromClient) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, reason: 'room_not_found' };
  if (room.figuresClaimed[figure]) return { ok: false, reason: 'figure_taken' };
  const valid = validateAndFlags(roomId, socketId, cardIndex, markedFromClient);
  if (!valid.ok) return valid;
  const { flags } = valid;
  if (!flags[figure]) return { ok: false, reason: 'invalid' };
  room.figuresClaimed[figure] = socketId;
  
  // Rastrear figura completada por jugador (para stats finales)
  try {
    const player = rooms.get(roomId)?.players.get(socketId);
    const pid = player?.username || socketId;
    
    if (!room.playerFigures.has(pid)) {
      room.playerFigures.set(pid, new Set());
    }
    room.playerFigures.get(pid).add(figure);
    
    console.log(`Player ${pid} completed figure: ${figure}`);
  } catch (e) {
    console.error('Error tracking player figure:', e);
  }
  // Registrar reclamo específico con detalles
  try {
    const details = buildClaimDetails(figure, markedFromClient);
    const claimKey = `${socketId}:${cardIndex}:${figure}`;
    const player = rooms.get(roomId)?.players.get(socketId) || {};
    rooms.get(roomId).specificClaims.set(claimKey, {
      playerId: socketId,
      cardIndex,
      figure,
      details,
      playerName: player.name,
      timestamp: Date.now()
    });
    // Encolar anuncio individual y procesar cola (pausar durante anuncios)
    room.announcementQueue.push({
      roomId,
      playerId: socketId,
      playerName: player.name,
      playerUsername: player.username,
      playerAvatarId: player.avatarId, // Enviar avatarId en lugar de avatarUrl completo
      figures: [figure],
      cardIndex
    });
  } catch (e) {
    console.warn('Failed to build claim details (manual):', e);
  }
  broadcastRoomState(roomId);
  // Procesar cola de anuncios (pausa y reanuda automáticamente cuando termine)
  processAnnouncementQueue(room);
  if (figure === 'full') {
    room.gameEnded = true;
    stopTimer(room);
    // Enviar gameOver después de que terminen los anuncios en cola
    const pending = room.announcementQueue.length;
    setTimeout(() => {
      // Stats: resultado de juego con figuras completadas
      try {
        const winner = room.players.get(socketId);
        const winnerId = winner?.username || socketId;
        
        // Convertir playerFigures Map a objeto con arrays
        const playersWithFigures = {};
        for (const [playerId, figuresSet] of room.playerFigures.entries()) {
          playersWithFigures[playerId] = Array.from(figuresSet);
        }
        
        // Registrar en dataStore (memoria)
        dataStore.recordGameResult({ 
          gameKey: room.gameKey, 
          roomId, 
          winnerId, 
          playersWithFigures 
        });
        
        // Registrar en base de datos
        statsService.recordGameResult({
          gameKey: room.gameKey,
          roomId,
          winnerId,
          playersWithFigures
        });
        
        console.log('Game result recorded (full):', { winnerId, playersWithFigures });
      } catch (e) {
        console.error('Error recording game result:', e);
      }
      io.to(roomId).emit('gameOver', { 
        roomId, 
        winner: socketId, 
        figuresClaimed: room.figuresClaimed,
        players: Array.from(room.players.entries()).map(([sid, p]) => ({
          id: sid,
          name: p.name,
          avatarUrl: p.avatarUrl
        }))
      });
    }, pending * 2500 + 1000);
  }
  return { ok: true };
}

function autoClaim(roomId, socketId, cardIndex, markedFromClient) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, reason: 'room_not_found' };
  const valid = validateAndFlags(roomId, socketId, cardIndex, markedFromClient);
  if (!valid.ok) return valid;
  const { flags } = valid;
  
  // Obtener información del jugador
  const player = room.players.get(socketId) || {};
  
  const newly = Object.keys(room.figuresClaimed)
    .filter(k => !room.figuresClaimed[k])
    .filter(k => flags[k]);
  if (newly.length === 0) return { ok: false, reason: 'no_new_figures' };
  
  // Marcar figuras como completadas y registrar reclamaciones específicas
  for (const f of newly) {
    room.figuresClaimed[f] = socketId;
    
    // Registrar reclamación específica
    const claimKey = `${socketId}:${cardIndex}:${f}`;
    const details = buildClaimDetails(f, markedFromClient);
    room.specificClaims.set(claimKey, {
      playerId: socketId,
      cardIndex: cardIndex,
      figure: f,
      details,
      playerName: player.name,
      timestamp: Date.now()
    });
    
    // Rastrear figura completada por jugador (para stats finales)
    try {
      const pid = player?.username || socketId;
      if (!room.playerFigures.has(pid)) {
        room.playerFigures.set(pid, new Set());
      }
      room.playerFigures.get(pid).add(f);
      console.log(`Player ${pid} completed figure: ${f}`);
    } catch (e) {
      console.error('Error tracking player figure:', e);
    }
  }
  
  // Crear anuncios individuales por prioridad
  const priorityOrder = ['full', 'border', 'diagonal', 'corners', 'column', 'row'];
  const sortedFigures = newly.sort((a, b) => {
    return priorityOrder.indexOf(a) - priorityOrder.indexOf(b);
  });
  
  // Agregar anuncios individuales a la cola
  sortedFigures.forEach(figure => {
    room.announcementQueue.push({
      roomId,
      playerId: socketId,
      playerName: player.name,
      playerUsername: player.username,
      playerAvatarId: player.avatarId, // Enviar avatarId en lugar de avatarUrl completo
      figures: [figure], // Solo una figura por anuncio
      cardIndex
    });
  });
  
  // Verificar si el juego terminó
  if (newly.includes('full')) {
    room.gameEnded = true;
    stopTimer(room);
  }
  
  broadcastRoomState(roomId);
  
  // Procesar cola de anuncios
  processAnnouncementQueue(room);
  
  // Si terminó el juego, enviar gameOver después de los anuncios
  if (newly.includes('full')) {
    setTimeout(() => {
      // Stats: resultado de juego con figuras completadas
      try {
        const winner = room.players.get(socketId);
        const winnerId = winner?.username || socketId;
        
        // Convertir playerFigures Map a objeto con arrays
        const playersWithFigures = {};
        for (const [playerId, figuresSet] of room.playerFigures.entries()) {
          playersWithFigures[playerId] = Array.from(figuresSet);
        }
        
        // Registrar en dataStore (memoria)
        dataStore.recordGameResult({ 
          gameKey: room.gameKey, 
          roomId, 
          winnerId, 
          playersWithFigures 
        });
        
        // Registrar en base de datos
        statsService.recordGameResult({
          gameKey: room.gameKey,
          roomId,
          winnerId,
          playersWithFigures
        });
        
        console.log('Game result recorded (multiple):', { winnerId, playersWithFigures });
      } catch (e) {
        console.error('Error recording game result:', e);
      }
      io.to(roomId).emit('gameOver', { 
        roomId, 
        winner: socketId, 
        figuresClaimed: room.figuresClaimed,
        players: Array.from(room.players.entries()).map(([sid, p]) => ({
          id: sid,
          name: p.name,
          avatarUrl: p.avatarUrl
        }))
      });
    }, sortedFigures.length * 2500 + 1000); // Esperar a que terminen todos los anuncios
  }
  
  return { ok: true, figures: newly };
}

// Verificar si todos los jugadores están listos para nueva partida
function checkAllPlayersReady(room) {
  const totalPlayers = room.players.size;
  const readyPlayers = room.playersReady.size;
  
  if (totalPlayers > 0 && readyPlayers === totalPlayers) {
    // Todos están listos, iniciar nueva partida
    setTimeout(() => {
      startGame(room.id);
    }, 1000);
  }
}

io.on('connection', (socket) => {
  // Listado inicial de salas
  socket.emit('rooms', getRoomsList());

  socket.on('listRooms', () => {
    socket.emit('rooms', getRoomsList());
  });

  socket.on('cleanupRooms', () => {
    // Limpiar salas vacías o inactivas
    let cleanedCount = 0;
    for (const [roomId, room] of rooms.entries()) {
      if (room.players.size === 0 || (!room.started && room.players.size === 0)) {
        // Limpiar timers si existen
        if (room.timer) clearInterval(room.timer);
        if (room.announceTimeout) clearTimeout(room.announceTimeout);
        rooms.delete(roomId);
        cleanedCount++;
      }
    }
    console.log(`Limpieza completada: ${cleanedCount} salas eliminadas`);
    broadcastRoomsList();
  });

  socket.on('createRoom', async ({ player, cardsPerPlayer }) => {
    const room = createRoom();
    let { name, avatarUrl, username } = player || {};
    let avatarId = null;
    
    // 🖼️ Sincronizar avatar desde la base de datos si existe
    try {
      if (username) {
        const existingPlayer = await statsService.getPlayerByUsername(username);
        if (existingPlayer && existingPlayer.avatarUrl) {
          console.log(`🔄 Avatar sincronizado para ${username}: ${existingPlayer.avatarId}`);
          avatarUrl = existingPlayer.avatarUrl;
          avatarId = existingPlayer.avatarId;
        }
        const player = await statsService.ensurePlayer(username, name, avatarUrl);
        avatarId = player.avatarId;
      }
      dataStore.ensurePlayer(username || socket.id, name, avatarUrl); 
    } catch (e) {
      console.warn('Error ensuring player in createRoom:', e);
    }
    
    room.players.set(socket.id, { name, avatarUrl, avatarId, username, cards: [], joinedAt: Date.now() });
    room.hostId = socket.id;
    if (cardsPerPlayer) room.cardsPerPlayer = Math.max(1, Math.min(4, Number(cardsPerPlayer) || 1));
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.emit('joined', { id: socket.id, hostId: room.hostId, roomId: room.id });
    broadcastRoomState(room.id);
    broadcastRoomsList();
  });

  socket.on('joinRoom', async ({ roomId, player }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    let { name, avatarUrl, username } = player || {};
    let avatarId = null;

    // Eliminar cualquier jugador anterior con el mismo username
    if (username) {
      for (const [sockId, p] of room.players.entries()) {
        if (p.username && p.username === username) {
          room.players.delete(sockId);
          room.playersReady && room.playersReady.delete(sockId);
        }
      }
    }

    // 🖼️ Sincronizar avatar desde la base de datos si existe
    try {
      if (username) {
        const existingPlayer = await statsService.getPlayerByUsername(username);
        if (existingPlayer && existingPlayer.avatarUrl) {
          console.log(`🔄 Avatar sincronizado para ${username}: ${existingPlayer.avatarId}`);
          avatarUrl = existingPlayer.avatarUrl;
          avatarId = existingPlayer.avatarId;
        }
        const player = await statsService.ensurePlayer(username, name, avatarUrl);
        avatarId = player.avatarId;
      }
      dataStore.ensurePlayer(username || socket.id, name, avatarUrl); 
    } catch (e) {
      console.warn('Error ensuring player in joinRoom:', e);
    }

    room.players.set(socket.id, { name, avatarUrl, avatarId, username, cards: [], joinedAt: Date.now() });
    if (!room.hostId) room.hostId = socket.id;
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.emit('joined', { id: socket.id, hostId: room.hostId, roomId: room.id });
    broadcastRoomState(room.id);
    broadcastRoomsList();
  });

  socket.on('leaveRoom', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Remover al jugador de la sala
    room.players.delete(socket.id);
    room.playersReady.delete(socket.id);
    socket.leave(roomId);
    socket.data.roomId = null;
    
    // Si era el anfitrión, transferir anfitrionazgo o eliminar sala
    if (socket.id === room.hostId) {
      if (room.players.size === 0) {
        // No hay más jugadores, eliminar la sala
        stopTimer(room);
        rooms.delete(roomId);
        broadcastRoomsList();
        return;
      } else {
        // Transferir anfitrionazgo al jugador más antiguo
        room.hostId = getOldestPlayer(room);
      }
    }
    
    broadcastRoomState(roomId);
    broadcastRoomsList();
  });

  // Nuevo evento: Jugador listo para nueva partida
  socket.on('readyForNewGame', ({ roomId }) => {
    const room = rooms.get(roomId || socket.data.roomId);
    if (!room || !room.gameEnded) return;
    
    room.playersReady.add(socket.id);
    broadcastRoomState(room.id);
    
    // Verificar si todos están listos
    checkAllPlayersReady(room);
  });

  socket.on('configure', ({ roomId, cardsPerPlayer }) => {
    const room = rooms.get(roomId || socket.data.roomId);
    if (!room || socket.id !== room.hostId || room.started) return;
    room.cardsPerPlayer = Math.max(1, Math.min(4, Number(cardsPerPlayer) || 1));
    broadcastRoomState(room.id);
    broadcastRoomsList();
  });

  socket.on('setSpeed', ({ roomId, speed }) => {
    const room = rooms.get(roomId || socket.data.roomId);
    if (!room || socket.id !== room.hostId) return;
    const allowed = [0.5, 1, 1.5, 2];
    const s = Number(speed);
    if (!allowed.includes(s)) return;
    room.speed = s;
    stopTimer(room);
    startTimerIfNeeded(room);
    broadcastRoomState(room.id);
  });

  socket.on('startGame', ({ roomId }) => {
    const room = rooms.get(roomId || socket.data.roomId);
    if (!room || socket.id !== room.hostId) return;
    startGame(room.id);
  });

  // Se mantienen pero no se muestran en UI
  socket.on('pauseDraw', ({ roomId }) => {
    const room = rooms.get(roomId || socket.data.roomId);
    if (!room || socket.id !== room.hostId) return;
    room.paused = true; stopTimer(room); broadcastRoomState(room.id);
  });
  socket.on('resumeDraw', ({ roomId }) => {
    const room = rooms.get(roomId || socket.data.roomId);
    if (!room || socket.id !== room.hostId) return;
    room.paused = false; stopTimer(room); startTimerIfNeeded(room); broadcastRoomState(room.id);
  });
  socket.on('nextBall', ({ roomId }) => {
    const room = rooms.get(roomId || socket.data.roomId);
    if (!room || socket.id !== room.hostId) return;
    room.paused = true; stopTimer(room);
    const n = room.bag.pop(); if (n == null) return;
    room.drawn.push(n); io.to(room.id).emit('ball', n); broadcastRoomState(room.id);
  });

  socket.on('claim', ({ roomId, figure, cardIndex, marked }) => {
    try {
      console.log(`Claim recibido de ${socket.id}:`, { roomId, figure, cardIndex, hasMarked: !!marked });
      const rid = roomId || socket.data.roomId;
      
      if (!rid) {
        console.error('Error: No roomId available');
        socket.emit('claimResult', { ok: false, reason: 'no_room_id' });
        return;
      }
      
      const res = figure
        ? checkClaim(rid, socket.id, figure, cardIndex, marked)
        : autoClaim(rid, socket.id, cardIndex, marked);
        
      console.log(`Resultado del claim para ${socket.id}:`, res);
      socket.emit('claimResult', res);
    } catch (error) {
      console.error('Error procesando claim:', error);
      socket.emit('claimResult', { ok: false, reason: 'server_error' });
    }
  });

  socket.on('getState', ({ roomId }) => {
    const room = rooms.get(roomId || socket.data.roomId);
    if (!room) return;
  const publicPlayers = Array.from(room.players.entries()).map(([sid, p]) => ({ 
    id: sid, 
    name: p.name, 
    avatarId: p.avatarId, // Solo enviar avatarId para caché eficiente
    username: p.username, 
    cards: p.cards 
  }));
    socket.emit('state', {
      roomId: room.id,
      name: room.name,
      started: room.started,
      paused: room.paused,
      cardsPerPlayer: room.cardsPerPlayer,
      hostId: room.hostId,
      players: publicPlayers,
      drawn: room.drawn,
      lastBall: room.drawn[room.drawn.length - 1] || null,
      figuresClaimed: room.figuresClaimed,
      gameEnded: room.gameEnded,
      playersReady: Array.from(room.playersReady),
    });
  });

  // Stats y Leaderboard
  socket.on('getStats', async ({ playerId }, cb) => {
    try {
      // usar username prioritariamente si está asociado al jugador en sala
      const room = rooms.get(socket.data.roomId);
      const p = room?.players.get(socket.id);
      const username = playerId || p?.username;
      
      if (username) {
        // Usar Prisma/statsService para datos persistentes
        const stats = await statsService.getPlayerStats(username, 'bingo');
        if (typeof cb === 'function') cb({ ok: true, stats });
        else socket.emit('stats', { ok: true, stats });
      } else {
        // Fallback a dataStore si no hay username
        const stats = dataStore.getPlayerStats(socket.id) || { totalGames: 0, wins: 0, points: 0 };
        if (typeof cb === 'function') cb({ ok: true, stats });
        else socket.emit('stats', { ok: true, stats });
      }
    } catch (e) {
      console.error('Error getting stats:', e);
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });
  
  socket.on('getLeaderboard', async ({ gameKey, limit }, cb) => {
    try {
      const leaderboard = await statsService.getLeaderboard(gameKey || 'bingo', limit || 10);
      if (typeof cb === 'function') cb({ ok: true, leaderboard });
      else socket.emit('leaderboard', { ok: true, leaderboard });
    } catch (e) {
      console.error('Error getting leaderboard:', e);
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });

  // Sincronización de avatares
  socket.on('getAvatarById', async ({ avatarId }, cb) => {
    try {
      const avatar = await statsService.getAvatarById(avatarId);
      if (typeof cb === 'function') cb({ ok: !!avatar, avatar });
    } catch (e) {
      console.error('Error getting avatar:', e);
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });

  socket.on('syncAvatars', async ({ lastSync }, cb) => {
    try {
      const avatars = lastSync ? 
        await statsService.getPlayersWithAvatarsUpdatedAfter(lastSync) :
        await statsService.getAllPlayersWithAvatars();
      if (typeof cb === 'function') cb({ ok: true, avatars });
    } catch (e) {
      console.error('Error syncing avatars:', e);
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });

  // Manejar mensajes de chat
  socket.on('sendChatMessage', ({ roomId, message }) => {
    console.log('Received chat message:', { roomId, message });
    const room = rooms.get(roomId || socket.data.roomId);
    if (!room) {
      console.log('Room not found for chat message');
      return;
    }
    
    // Verificar que el jugador está en la sala
    if (!room.players.has(socket.id)) {
      console.log('Player not in room for chat message');
      return;
    }
    
    console.log('Broadcasting chat message to room:', roomId || socket.data.roomId);
    // Reenviar el mensaje a todos en la sala
    io.to(roomId || socket.data.roomId).emit('chatMessage', message);
  });

  // Nuevos endpoints para rankings y búsqueda
  socket.on('getTopPlayers', async ({ gameKey, criteria, limit }, cb) => {
    try {
      const topPlayers = await statsService.getTopPlayers(gameKey || 'bingo', criteria || 'points', limit || 10);
      if (typeof cb === 'function') cb({ ok: true, topPlayers });
    } catch (e) {
      console.error('Error getting top players:', e);
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });

  socket.on('searchPlayers', async ({ query, limit }, cb) => {
    try {
      const players = await statsService.searchPlayers(query, limit || 10);
      if (typeof cb === 'function') cb({ ok: true, players });
    } catch (e) {
      console.error('Error searching players:', e);
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });

  // Endpoint para obtener avatar por avatarId (para caché eficiente)
  socket.on('getAvatar', async ({ avatarId }, cb) => {
    console.log('📋 Received getAvatar request:', { avatarId });
    
    try {
      if (!avatarId) {
        if (typeof cb === 'function') cb({ ok: false, error: 'AvatarId is required' });
        return;
      }

      // Buscar jugador por avatarId en la base de datos
      const player = await statsService.getPlayerByAvatarId(avatarId);
      
      if (!player || !player.avatarUrl) {
        console.log('❌ Avatar not found:', avatarId);
        if (typeof cb === 'function') cb({ ok: false, error: 'Avatar not found' });
        return;
      }

      console.log(`✅ Avatar found: ${player.username} -> ${avatarId} (${(player.avatarUrl.length/1024).toFixed(1)}KB)`);
      
      if (typeof cb === 'function') cb({ 
        ok: true, 
        avatar: {
          avatarId: player.avatarId,
          avatarUrl: player.avatarUrl,
          username: player.username
        }
      });
    } catch (e) {
      console.error('Error getting avatar:', e);
      if (typeof cb === 'function') cb({ ok: false, error: e.message });
    }
  });

  // Endpoint para actualizar perfil
  socket.on('updateProfile', async ({ username, name, avatarUrl }, cb) => {
    console.log('📥 Received updateProfile request:', { 
      username, 
      name, 
      hasAvatar: !!avatarUrl,
      avatarSizeKB: avatarUrl ? (avatarUrl.length / 1024).toFixed(2) : 0
    });
    
    try {
      if (!username) {
        console.log('❌ updateProfile failed: Username is required');
        if (typeof cb === 'function') cb({ ok: false, error: 'Username is required' });
        return;
      }

      if (avatarUrl) {
        console.log('🖼️ Avatar details:');
        console.log('   - Size:', avatarUrl.length, 'characters');
        console.log('   - Size in MB:', (avatarUrl.length / 1024 / 1024).toFixed(2));
        console.log('   - Starts with:', avatarUrl.substring(0, 50));
        
        // Verificar si es una imagen base64 válida
        if (!avatarUrl.startsWith('data:image/')) {
          console.log('⚠️ Avatar does not start with data:image/');
        }
        
        // Validar tamaño máximo más estricto (800KB en base64)
        if (avatarUrl.length > 800 * 1024) {
          console.log('❌ updateProfile failed: Avatar too large (max 800KB)');
          if (typeof cb === 'function') cb({ ok: false, error: 'La imagen es demasiado grande (máximo 800KB)' });
          return;
        }
      }

      console.log('💾 Updating player profile in database...');
      // Actualizar en la base de datos usando statsService
      const player = await statsService.ensurePlayer(username, name, avatarUrl);
      console.log('Player profile updated in database:', player.username);
      
      // También actualizar en dataStore para la sesión actual
      try { 
        dataStore.ensurePlayer(username, name, avatarUrl); 
        console.log('Player profile updated in dataStore');
      } catch (e) {
        console.warn('Error updating dataStore:', e);
      }

      // 🔄 Sincronizar el perfil actualizado en todas las salas donde esté el jugador
      console.log('🔄 Syncing updated profile across rooms...');
      for (const [roomId, room] of rooms.entries()) {
        const playerInRoom = room.players.get(socket.id);
        if (playerInRoom && playerInRoom.username === username) {
          // Actualizar los datos del jugador en esta sala
          room.players.set(socket.id, { 
            ...playerInRoom, 
            name: player.name, 
            avatarUrl: player.avatarUrl 
          });
          
          // Notificar a todos en la sala sobre la actualización
          console.log(`🔄 Broadcasting updated profile to room ${roomId}`);
          broadcastRoomState(roomId);
        }
      }

      const response = { 
        ok: true, 
        player: {
          username: player.username,
          name: player.name,
          avatarUrl: player.avatarUrl,
          avatarId: player.avatarId
        }
      };
      
      console.log('Sending updateProfile response:', response);
      if (typeof cb === 'function') cb(response);
    } catch (e) {
      console.error('Error updating profile:', e);
      const errorResponse = { ok: false, error: e.message };
      console.log('Sending updateProfile error response:', errorResponse);
      if (typeof cb === 'function') cb(errorResponse);
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    
    // Remover al jugador de la sala
    room.players.delete(socket.id);
    room.playersReady.delete(socket.id);
    
    // Si era el anfitrión, transferir anfitrionazgo o eliminar sala
    if (socket.id === room.hostId) {
      if (room.players.size === 0) {
        // No hay más jugadores, eliminar la sala
        stopTimer(room);
        rooms.delete(roomId);
        broadcastRoomsList();
        return;
      } else {
        // Transferir anfitrionazgo al jugador más antiguo
        room.hostId = getOldestPlayer(room);
      }
    }
    
    broadcastRoomState(roomId);
    broadcastRoomsList();
  });
});

app.get('/', (_req, res) => res.send('Bingo backend OK'));

const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => console.log(`Backend listening on ${HOST}:${PORT}`));
