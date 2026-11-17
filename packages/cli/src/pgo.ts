/* `scriptc build --pgo`: the profiling half. The compiler half (an instrumented build, `layout-order`, an ordered build) lives in main.ts; this file
 * runs the user's program under the profiler and delivers the epoch signal.
 *
 * SAFETY. The profiling run executes the user's program (or whatever driver they name), so it only ever happens when `--pgo-run` is given
 * explicitly, and never from a normal build. The command is split into argv here and spawned WITHOUT a shell: no pipes, redirections, globs or
 * variable expansion. A command that needs them says so by naming a shell itself (`--pgo-run "sh -c '...'"`). */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** Splits a command line into argv: whitespace separates words; single quotes keep everything literal; double quotes keep whitespace and honour
 * backslash escapes of `"` and `\`; a backslash outside quotes escapes the next character. An unterminated quote is an error. */
export function splitArgv(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let started = false;
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i]!;
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1);
      if (end < 0) throw new Error("unterminated ' in --pgo-run");
      cur += cmd.slice(i + 1, end);
      started = true;
      i = end + 1;
    } else if (c === '"') {
      i++;
      let closed = false;
      while (i < cmd.length) {
        const d = cmd[i]!;
        if (d === "\\" && (cmd[i + 1] === '"' || cmd[i + 1] === "\\")) {
          cur += cmd[i + 1]!;
          i += 2;
        } else if (d === '"') {
          closed = true;
          i++;
          break;
        } else {
          cur += d;
          i++;
        }
      }
      if (!closed) throw new Error('unterminated " in --pgo-run');
      started = true;
    } else if (c === "\\" && i + 1 < cmd.length) {
      cur += cmd[i + 1]!;
      started = true;
      i += 2;
    } else if (/\s/.test(c)) {
      if (started) out.push(cur);
      cur = "";
      started = false;
      i++;
    } else {
      cur += c;
      started = true;
      i++;
    }
  }
  if (started) out.push(cur);
  return out;
}

export interface ProfilingRun {
  argv: readonly string[];
  cwd: string;
  /** The instrumented binary: substituted for `{bin}` in the arguments and exported as SCR_PGO_BIN. */
  bin: string;
  profilePath: string;
  pidPath: string;
  /** Sends SIGUSR1 to the profiled process when a line of the command's output first matches; null = no epoch signal. */
  signal: RegExp | null;
  /** A second SIGUSR1, sent when a line first matches AFTER the epoch signal: it opens the END epoch (shutdown, the last requests), which the order
   * file places after the steady set. null = the profile has two epochs. */
  endSignal?: RegExp | null;
  timeoutMs: number;
}

export interface ProfilingResult {
  exitCode: number | null;
  signalled: boolean;
  timedOut: boolean;
}

function readPid(pidPath: string): number | null {
  try {
    const n = Number(readFileSync(pidPath, "utf8").trim());
    return Number.isInteger(n) && n > 1 ? n : null;
  } catch {
    return null;
  }
}

/** Runs the command to completion (or to its timeout). Throws a plain Error naming what went wrong; the caller turns it into a CLI failure. */
export async function runProfiling(run: ProfilingRun): Promise<ProfilingResult> {
  if (run.argv.length === 0) throw new Error("--pgo-run is empty");
  const args = run.argv.slice(1).map((a) => a.split("{bin}").join(run.bin));
  const program = run.argv[0]!.split("{bin}").join(run.bin);
  return new Promise<ProfilingResult>((resolveRun, rejectRun) => {
    const child = spawn(program, args, {
      cwd: run.cwd,
      env: { ...process.env, SCR_PGO_BIN: run.bin, SCR_LAYOUT_PROFILE_OUT: run.profilePath, SCR_LAYOUT_PROFILE_PID: run.pidPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let signalled = false;
    let endSignalled = false;
    let timedOut = false;
    let buf = "";
    const trySignal = (): void => {
      // The profiled process writes its pid at start; a driver may start it a moment after the line we matched.
      let tries = 0;
      const attempt = (): void => {
        const pid = readPid(run.pidPath);
        if (pid !== null) {
          try {
            process.kill(pid, "SIGUSR1");
            signalled = true;
          } catch {
            /* already gone */
          }
          return;
        }
        if (++tries < 40) setTimeout(attempt, 50);
      };
      attempt();
    };
    const onData = (chunk: Buffer): void => {
      process.stderr.write(chunk); // the command's output stays visible: it is the user's program
      const wantEnd = run.endSignal != null && signalled && !endSignalled;
      if (run.signal === null || (signalled && !wantEnd)) return;
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!signalled && run.signal.test(line)) {
          trySignal();
          if (run.endSignal == null) break;
        } else if (signalled && !endSignalled && run.endSignal != null && run.endSignal.test(line)) {
          endSignalled = true;
          trySignal();
          break;
        }
      }
      if (buf.length > 1 << 20) buf = buf.slice(-4096);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => {
      timedOut = true;
      const pid = readPid(run.pidPath);
      // SIGTERM on the profiled process makes the profiler dump and exit; the command itself is asked to stop the same way.
      if (pid !== null) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* gone */
        }
      }
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, run.timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectRun(new Error(`--pgo-run: could not start ${program}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!existsSync(run.profilePath)) {
        rejectRun(
          new Error(
            `--pgo-run: the profiled program wrote no profile (${run.profilePath}). The command must start {bin} (or $SCR_PGO_BIN) and let it exit; ` +
              `a program that is killed without SIGTERM loses its profile.`,
          ),
        );
        return;
      }
      resolveRun({ exitCode: code, signalled, timedOut });
    });
  });
}
