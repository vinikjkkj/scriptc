const fs = require("fs");
fs.stat("./statenoent-missing-19102", (err, s) => {
  console.log("code", err ? err.code : "none");
  try {
    console.log("size", s.size);
  } catch (e) {
    console.log("caught", e.message);
  }
});
