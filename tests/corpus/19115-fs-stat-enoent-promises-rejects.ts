import * as fs from "node:fs";
async function main() {
  try {
    const s = await fs.promises.stat("./statenoent-missing-19115");
    console.log("ok", s.size >= 0);
  } catch (e) {
    console.log("rejected", (e as NodeJS.ErrnoException).code, (e as NodeJS.ErrnoException).syscall);
  }
}
main();
