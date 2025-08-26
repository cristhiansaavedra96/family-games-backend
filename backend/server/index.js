// Servidor Node.js + Socket.IO - Sala única, sorteo auto 1s/0.5s, voz manejada en frontend
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const { shuffleBag, generateCard, checkFigures } = require('./games/bingo');

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
    started: false,
    paused: true,
  speed: 1, // multiplicador x0.5..x2
    cardsPerPlayer: 1,
    players: new Map(), // socketId -> { name, avatarUrl, cards: number[][] }
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
    players: Array.from(r.players.entries()).map(([sid, p]) => ({ id: sid, name: p.name, avatarUrl: p.avatarUrl })),
    started: r.started,
    hostId: r.hostId,
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
    cards: p.cards,
  }));
  io.to(roomId).emit('state', {
    roomId,
    name: room.name,
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
  const baseMs = 6000;
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

function checkClaim(roomId, socketId, figure, cardIndex, markedFromClient) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, reason: 'room_not_found' };
  if (room.figuresClaimed[figure]) return { ok: false, reason: 'figure_taken' };
  const valid = validateAndFlags(roomId, socketId, cardIndex, markedFromClient);
  if (!valid.ok) return valid;
  const { flags } = valid;
  if (!flags[figure]) return { ok: false, reason: 'invalid' };
  room.figuresClaimed[figure] = socketId;
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
      playerAvatar: player.avatarUrl,
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
      playerAvatar: player.avatarUrl,
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

  socket.on('createRoom', ({ player, cardsPerPlayer }) => {
    const room = createRoom();
    const { name, avatarUrl } = player || {};
    room.players.set(socket.id, { name, avatarUrl, cards: [], joinedAt: Date.now() });
    room.hostId = socket.id;
    if (cardsPerPlayer) room.cardsPerPlayer = Math.max(1, Math.min(4, Number(cardsPerPlayer) || 1));
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.emit('joined', { id: socket.id, hostId: room.hostId, roomId: room.id });
    broadcastRoomState(room.id);
    broadcastRoomsList();
  });

  socket.on('joinRoom', ({ roomId, player }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const { name, avatarUrl } = player || {};
    room.players.set(socket.id, { name, avatarUrl, cards: [], joinedAt: Date.now() });
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
    const publicPlayers = Array.from(room.players.entries()).map(([sid, p]) => ({ id: sid, name: p.name, avatarUrl: p.avatarUrl, cards: p.cards }));
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
