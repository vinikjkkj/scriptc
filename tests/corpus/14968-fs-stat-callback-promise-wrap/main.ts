// A promise wrapper around the callback form: the await resumes after the
// callback has fired, with the Stats it delivered.
import { chmodSync, existsSync, mkdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

function statOf(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    fs.stat(path, function (err, st) {
      if (err) reject(err);
      else resolve(st.size);
    });
  });
}
async function main(): Promise<void> {
  const q = "tmp-14968-" + tail(process.argv[1]) + ".txt";
  if (existsSync(q)) unlinkSync(q);
  writeFileSync(q, "12345678");
  const n = await statOf(q);
  console.log("size via promise:", n);
  unlinkSync(q);
  try {
    await statOf("tmp-14968-absent-file");
  } catch (e) {
    console.log("rejected:", (e as NodeJS.ErrnoException).code);
  }
}
main();
