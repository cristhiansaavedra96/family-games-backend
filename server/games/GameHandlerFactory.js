// Factory para crear game handlers según el tipo de juego
const BingoGameHandler = require("./bingo/BingoGameHandler");
const TrucoGameHandler = require("./truco/TrucoGameHandler");

class GameHandlerFactory {
  static createHandler(gameKey, room, io) {
    switch (gameKey) {
      case "bingo":
        return new BingoGameHandler(room, io);
      case "truco":
        return new TrucoGameHandler(room, io);
      default:
        throw new Error(`Game handler for '${gameKey}' not implemented`);
    }
  }

  static getSupportedGames() {
    return ["bingo", "truco"];
  }
}

module.exports = GameHandlerFactory;
