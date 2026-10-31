const fs = require("fs");
fs.stat("./statenoent-missing-19113", (err1, s1) => {
  if (err1) console.log("miss", err1.code);
  console.log("absent", s1 === undefined);
  fs.stat("/", (err2, s2) => {
    console.log("hit", err2 === null, s2.isDirectory());
  });
});
