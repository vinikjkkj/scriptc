/* Runs a child process with its stdout and stderr written to FILES, not
 * pipes, and returns the bytes once the child has exited.
 *
 * Why files: a child's stdout that is a pipe is written asynchronously
 * on Windows (libuv), so a child that dies abnormally after writing can
 * lose the tail of what it printed. The reference (Node) leg then compares
 * a truncated stream against a complete native one (CI 40219257314,
 * 40356161346, 40364003139: "http refused" with the next line missing).
 * A file is written synchronously on every platform, so whatever the
 * child wrote before it died is in the file. Resolution is on 'exit': with
 * no pipes there is no stream left to drain. */
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface CapturedRun {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

/** The child's stdin is the CALLER's choice, never defaulted: execFile's
 * default is a pipe (closed at once by the caller), and runLane's is
 * "ignore". A TTY-probing program reads a different answer under each. */
export function runCaptured(
  cmd: string,
  args: string[],
  scratchRoot: string,
  stdin: "ignore" | "pipe",
): Promise<CapturedRun> {
  mkdirSync(scratchRoot, { recursive: true });
  const scratch = mkdtempSync(join(scratchRoot, "captured-"));
  const outPath = join(scratch, "stdout");
  const errPath = join(scratch, "stderr");
  const outFd = openSync(outPath, "w");
  const errFd = openSync(errPath, "w");
  return new Promise<CapturedRun>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      closeSync(outFd);
      closeSync(errFd);
      fn();
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { stdio: [stdin, outFd, errFd] });
      child.stdin?.end();
    } catch (err) {
      finish(() => {
        rmSync(scratch, { recursive: true, force: true });
        reject(err);
      });
      return;
    }
    child.on("error", (err) =>
      finish(() => {
        rmSync(scratch, { recursive: true, force: true });
        reject(err);
      }),
    );
    child.on("exit", (code, signal) =>
      finish(() => {
        try {
          // Same contract as execFile: a signal death is an error, not a status.
          if (code === null) {
            reject(new Error(`${cmd} died to ${signal ?? "an unknown signal"}`));
            return;
          }
          resolve({ stdout: readFileSync(outPath), stderr: readFileSync(errPath), exitCode: code });
        } catch (err) {
          reject(err);
        } finally {
          rmSync(scratch, { recursive: true, force: true });
        }
      }),
    );
  });
}

/** The Node oracle's exit status and stderr tail, for a stdout mismatch
 * message. Attached to the stdout assertion so a crashed oracle is named
 * as one, not compared as an ordinary divergence. */
export function oracleNote(exitCode: number, stderr: Buffer | string): string {
  const text = typeof stderr === "string" ? stderr : stderr.toString("utf8");
  const tail = text.length > 4000 ? "...\n" + text.slice(-4000) : text;
  return `node oracle exit ${exitCode}; oracle stderr:\n${tail}`;
}
