const fs = require("fs");
fs.stat("./statenoent-missing-19109", (err, s) => {
  console.log("undef", s === undefined);
  try {
    console.log(s.isDirectory());
  } catch (e) {
    console.log("caught", e.message);
  }
});
