import { Client } from "pg";

// The connection step: connect to a closed local port and report the error exactly as Node's pg does.
async function main(): Promise<void> {
  const client = new Client({ host: "127.0.0.1", port: 1, user: "u", password: "p", database: "d" });
  try {
    await client.connect();
    console.log("connected");
    await client.end();
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.log(err.code, err.errno, err.syscall, err.message);
  }
}
main().catch((e) => console.log("failed", (e as Error).message));
