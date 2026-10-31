const fs = require("fs");
fs.stat("./statenoent-missing-19117", (err, s) => {
  if (s !== undefined) console.log("present");
  else if (err) console.log("absent", err.code);
});
