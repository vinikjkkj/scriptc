// fs.readFile on a missing file, TypeScript callback: the error object's
// shape (code, errno, syscall, path, message, its keys), the data argument
// (undefined in Node, so reading a property of it throws a catchable TypeError),
// and a success after the failure.
import * as fs from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

const dir = "tmp-18901-" + tail(process.argv[1]);
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
const missing = dir + "/absent.txt";

fs.readFile(missing, (e, d) => {
  if (e) {
    console.log("err", e instanceof Error, e.name, e.code, e.errno, e.syscall, e.path === missing, e.message.indexOf("ENOENT") >= 0);
    console.log("keys", Object.keys(e).sort().join(","));
  }
  try {
    console.log("len", d.length);
  } catch (x) {
    console.log("caught", (x as Error).constructor.name);
  }
  fs.writeFileSync(dir + "/ok.txt", "ok");
  fs.readFile(dir + "/ok.txt", "utf8", (e2, d2) => {
    console.log("after", e2, d2);
    fs.rmSync(dir + "/ok.txt");
    fs.rmdirSync(dir);
  });
});
console.log("main end");
