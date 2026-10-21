import * as fs from "fs";
function probe(path: string): string {
  try {
    fs.readFileSync(path);
    return "ok";
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return [err.message, err.code, err.errno, err.syscall, err.path].join("|");
  }
}
console.log(probe("/nonexistent-scr8344/a"), probe("/proc"), probe("/nonexistent-scr8344"));
try { fs.openSync("/nonexistent-scr8344/b", "r"); } catch (e) {
  const err = e as NodeJS.ErrnoException;
  if (err.errno === -2 && err.syscall === "open") console.log("matched", err.path);
}
