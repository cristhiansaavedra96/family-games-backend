// Factory para crear game handlers según el tipo de juego
const BingoGameHandler = require("./bingo/BingoGameHandler");
const TrucoGameHandler = require("./truco/TrucoGameHandler");
let UnoGameHandler; // Carga diferida para evitar error si carpeta aún no existe

class GameHandlerFactory {
  static createHandler(gameKey, room, io) {
    switch (gameKey) {
      case "bingo":
        return new BingoGameHandler(room, io);
      case "truco":
        return new TrucoGameHandler(room, io);
      case "uno":
        if (!UnoGameHandler) {
          try {
            UnoGameHandler = require("./uno/UnoGameHandler");
          } catch (e) {
            throw new Error(
              "UNO GameHandler no disponible: " + (e?.message || e)
            );
          }
        }
        return new UnoGameHandler(room, io);
      default:
        throw new Error(`Game handler for '${gameKey}' not implemented`);
    }
  }

  static getSupportedGames() {
    return ["bingo", "truco", "uno"];
  }
}

module.exports = GameHandlerFactory;
