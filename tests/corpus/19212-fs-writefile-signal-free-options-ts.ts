// TypeScript fs.writeFile / fs.appendFile callbacks with signal-free options: a typed
// options record without a signal member, a bare encoding, and no options. Each step
// starts after the previous callback, so completion order is fixed. Works in a temp
// directory under cwd and removes it.
import * as fs from "node:fs";
const D: string = "fsw-19212";
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D);
const report = (tag: string) => (e: NodeJS.ErrnoException | null): void => console.log(tag, e);
fs.writeFile(D + "/t1.txt", "one", (e1) => {
  report("plain")(e1);
  fs.writeFile(D + "/t2.txt", "two", "utf8", (e2) => {
    report("enc")(e2);
    fs.writeFile(D + "/t3.txt", "three", { flag: "w", flush: false }, (e3) => {
      report("record")(e3);
      fs.appendFile(D + "/t3.txt", "+x", { flag: "a" }, (e4) => {
        report("append")(e4);
        console.log("read", fs.readFileSync(D + "/t3.txt", "utf8"), fs.readFileSync(D + "/t1.txt", "utf8"));
        fs.rmSync(D, { recursive: true, force: true });
        console.log("main end");
      });
    });
  });
});
console.log("main end");
