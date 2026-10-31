const fs = require("fs");
fs.stat("./statenoent-missing-19108", (err, s) => {
  if (err) console.log("code", err.code);
  else console.log("none");
  console.log("typeof", typeof s);
});
