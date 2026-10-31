const fs = require("fs");
fs.stat("/", (err, s) => {
  console.log("err", err === null, s === undefined);
  console.log("dir", s.isDirectory(), s.isFile(), s.size >= 0);
});
