// An error built and stamped with code/errno by JavaScript (mysql2's Packet.asError) and read by typed code
// as NodeJS.ErrnoException: the own properties the program assigned are what the typed reads answer.
import { asError } from "./lib.js";
async function main() {
  try {
    await new Promise((_, reject) => reject(asError(1062, "dup")));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.log("error", err.code, err.errno, err.message);
  }
}
main();
