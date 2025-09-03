const BingoGameHandler = require("./BingoGameHandler");
const bingoLogic = require("./logic");

module.exports = {
  BingoGameHandler,
  ...bingoLogic,
};
