var arrayParser = require("./arrayParser");

exports.parseIntArray = function (value) {
  if (!value) return null;
  var p = arrayParser.create(value, function (entry) {
    return parseInt(entry, 10);
  });
  return p.parse();
};
