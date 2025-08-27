const BingoGameHandler = require('./handler');
const bingoLogic = require('./logic');

module.exports = {
  BingoGameHandler,
  ...bingoLogic
};
