// fs.read callback in TypeScript: the positional form, the options-object form
// ({ offset, length, position }), and the default-buffer form read(fd, cb).
// Scratch paths derive from argv[1].
import * as fs from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

const dir = "tmp-18904-" + tail(process.argv[1]);
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
const file = dir + "/data.txt";
fs.writeFileSync(file, "hello world");
const fd = fs.openSync(file, "r");
const b = Buffer.alloc(5);

fs.read(fd, b, 0, 5, 0, (e, n, buf) => {
  console.log("positional", e, n, buf.length, buf.toString("utf8"));
  const c = Buffer.alloc(3);
  fs.read(fd, c, { offset: 1, length: 2, position: 6 }, (e2, n2, buf2) => {
    console.log("options", e2, n2, buf2.length, c[1], c[2]);
    fs.read(fd, (e3, n3, big) => {
      console.log("default", e3, n3, big.length);
      fs.closeSync(fd);
      fs.rmSync(file);
      fs.rmdirSync(dir);
    });
  });
});
console.log("main end");
