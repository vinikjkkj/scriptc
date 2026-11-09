// the debug package's entry: its whole export is another module's, and that module's value is a function carrying properties set at run time
if (typeof process === "undefined" || process.type === "renderer") {
  module.exports = require("./node.cjs");
} else {
  module.exports = require("./node.cjs");
}
