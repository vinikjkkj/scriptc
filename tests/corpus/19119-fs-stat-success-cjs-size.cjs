const fs = require("fs");
fs.stat("/", (err, s) => {
  console.log("err", err, "dir", s.isDirectory(), typeof s.size);
});
