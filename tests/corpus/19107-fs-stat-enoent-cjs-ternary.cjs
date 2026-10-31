const fs = require("fs");
fs.stat("./statenoent-missing-19107", (err, s) => {
  const c = err ? err.code : null;
  console.log("c", c, s === undefined, s === null);
});
