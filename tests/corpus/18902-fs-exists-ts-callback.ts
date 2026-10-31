// fs.exists callback in TypeScript: a present path answers true, a missing
// path false, and the answers arrive after the synchronous code (Node's
// deprecated callback shape). Scratch paths derive from argv[1].
import * as fs from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

const dir = "tmp-18902-" + tail(process.argv[1]);
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
const present = dir + "/here.txt";
fs.writeFileSync(present, "x");

fs.exists(present, (ok) => {
  console.log("present", ok);
  fs.exists(dir + "/nope.txt", (ok2) => {
    console.log("missing", ok2);
    fs.rmSync(present);
    fs.rmdirSync(dir);
  });
});
console.log("main end");
