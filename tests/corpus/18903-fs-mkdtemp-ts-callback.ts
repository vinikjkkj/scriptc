// fs.mkdtemp callback in TypeScript: the string form, the { encoding: "buffer" }
// form (a Buffer answer), and the encoding-less options form. The made
// directories are named by the callback, so only their shapes are printed.
import * as fs from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

const dir = "tmp-18903-" + tail(process.argv[1]);
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

fs.mkdtemp(dir + "/a-", (e, p) => {
  console.log("string", e, typeof p, p.startsWith(dir + "/a-"), fs.existsSync(p));
  fs.mkdtemp(dir + "/b-", { encoding: "buffer" }, (e2, p2) => {
    console.log("buffer", e2, typeof p2, p2.length > dir.length, p2.toString("utf8").startsWith(dir + "/b-"));
    fs.mkdtemp(dir + "/c-", { encoding: "utf8" }, (e3, p3) => {
      console.log("utf8", e3, typeof p3, p3.startsWith(dir + "/c-"));
      fs.rmdirSync(p);
      fs.rmdirSync(p2.toString("utf8"));
      fs.rmdirSync(p3);
      fs.rmdirSync(dir);
    });
  });
});
console.log("main end");
