// fs.readFile callback forms in TypeScript: no options, a utf8 string,
// { encoding }, { encoding: null }, an fd, a named import, and a missing
// file's error object. Scratch paths derive from THIS process's argv[1], so
// Node and the native binary (run concurrently in one cwd) never share files.
import * as fs from "node:fs";
import { readFile } from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

const dir = "tmp-18900-" + tail(process.argv[1]);
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
const file = dir + "/data.txt";
fs.writeFileSync(file, "héllo");

fs.readFile(file, (e, d) => {
  console.log("buffer", e, d.length, d.toString("utf8"));
  fs.readFile(file, "utf8", (e2, d2) => {
    console.log("utf8", e2, d2);
    fs.readFile(file, { encoding: "utf8" }, (e3, d3) => {
      console.log("opts", e3, d3);
      fs.readFile(file, { encoding: null }, (e4, d4) => {
        console.log("null", e4, d4.length);
        const fd = fs.openSync(file, "r");
        fs.readFile(fd, "utf8", (e5, d5) => {
          console.log("fd", e5, d5);
          fs.closeSync(fd);
          readFile(file, "utf8", (e6, d6) => {
            console.log("named", e6, d6.length);
            fs.rmSync(file);
            fs.rmdirSync(dir);
          });
        });
      });
    });
  });
});
console.log("main end");
