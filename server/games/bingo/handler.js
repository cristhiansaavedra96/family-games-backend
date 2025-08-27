const { shuffleBag, generateCard, checkFigures } = require('./logic');

class BingoGameHandler {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomId -> state
    this.roomCounter = 1;
  }

  createRoom() {
    const id = String(this.roomCounter++);
    const room = {
      id,
      name: `Sala ${id}`,
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
      figuresClaimed: { corners: null, row: null, column: null, diagonal: null, border: null, full: null },
      // Nuevos campos para sistema de nueva partida
      gameEnded: false,
      playersReady: new Set(), // Set de socketIds listos para nueva partida
      announcementQueue: [], // Cola de anuncios individuales
      processingAnnouncements: false,
    };
    this.rooms.set(id, room);
    return room;
  }

  getRoomsList() {
    return Array.from(this.rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      players: Array.from(r.players.entries()).map(([sid, p]) => ({ id: sid, name: p.name, avatarUrl: p.avatarUrl })),
      started: r.started,
      hostId: r.hostId,
    }));
  }

  broadcastRoomsList() {
    this.io.emit('rooms', this.getRoomsList());
  }

  broadcastRoomState(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const publicPlayers = Array.from(room.players.entries()).map(([sid, p]) => ({
      id: sid,
      name: p.name,
      avatarUrl: p.avatarUrl,
      cards: p.cards,
    }));
    this.io.to(roomId).emit('state', {
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
      gameEnded: room.gameEnded,
      playersReady: Array.from(room.playersReady),
    });
  }

  stopTimer(room) { 
    if (room.timer) { 
      clearInterval(room.timer); 
      room.timer = null; 
    } 
  }

  startTimerIfNeeded(room) {
    if (!room.started || room.paused || room.timer) return;
    const baseMs = 6000;
    const factor = Number(room.speed) || 1;
    const intervalMs = Math.max(500, Math.round(baseMs / factor));
    room.timer = setInterval(() => this.drawNextBall(room), intervalMs);
  }

  drawNextBall(room) {
    if (!room.started || room.paused) return;
    const n = room.bag.pop();
    if (n == null) {
      this.stopTimer(room);
      return;
    }
    room.drawn.push(n);
    this.broadcastRoomState(room.id);
    this.io.to(room.id).emit('newBall', n);
  }

  // Continúa con el resto de métodos...
  // [El resto del código del servidor original se movería aquí]

  handleSocketEvents(socket) {
    // Manejadores de eventos específicos del bingo
    socket.on('joinRoom', (data) => {
      // Implementación...
    });

    socket.on('claim', (data) => {
      // Implementación...
    });

    socket.on('setSpeed', (data) => {
      // Implementación...
    });

    // ... otros eventos
  }
}

module.exports = BingoGameHandler;
