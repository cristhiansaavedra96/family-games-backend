const TrucoGameHandler = require("./TrucoGameHandler");
const trucoLogic = require("./logic");

module.exports = {
  TrucoGameHandler,
  ...trucoLogic,
};
