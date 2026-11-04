"use strict";
// errno, syscall, address, port (a socket's connect failure) and path (an fs failure) are own properties of the error object in Node,
// whatever the static type of the receiver says: a JS handler's `err` is typed Error.
const Net = require("net");
const fs = require("fs");
const lines = [];
const s = Net.connect(1, "127.0.0.1");
s.on("error", (e) => {
  lines.push([e.name, e.code, e.errno, e.syscall, e.address, e.port].join(","));
  lines.push(e.message);
  fs.readFile("/nonexistent/dir/file.txt", "utf8", (err, data) => {
    lines.push([err.code, err.errno, err.syscall, err.path].join(","));
    lines.push(String(e.hostname) + "," + String(e.dest) + "," + String(e.nothing));
    console.log(lines.join("\n"));
  });
});
