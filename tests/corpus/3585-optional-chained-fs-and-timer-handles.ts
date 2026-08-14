// Four more receiver-typed lowerings whose `?.` spelling was declined by a
// raw token test: Stats, Dirent, FSWatcher, and the Timeout handle.
//
// The timer one is the interesting one, because its guard was already
// DOCUMENTED as making the distinction this fixture pins:
//
//   `t.unref?.()` (the defensive optional CALL) is the plain call: the
//   method always exists on a Timeout handle. A `t?.unref()` receiver
//   guard is real narrowing and stays with the chain machinery.
//
// The comment is right and the code did not implement it. The guard read
// `access.questionDotToken` — the token of `t?.unref` — and returned null,
// including when the optional-chain machinery was the caller asking for the
// plain lowering it had just proved safe. So the receiver-guard spelling the
// comment sends to "the chain machinery" arrived back here and was refused
// again. `chainBlocked(access)` keeps the documented split exactly: the
// call's own token is still not this lowering's business, and the access's
// token is honoured unless the chain already handled it.
//
// The scratch directory is derived from THIS process's own identity: the
// harness runs Node and the native binary concurrently in one cwd, and
// argv[1]'s trailing segment differs between the two.

import { mkdirSync, readdirSync, rmSync, statSync, watch, writeFileSync } from "node:fs";

function tail(path: string): string {
    let i = path.length - 1;
    while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
        i = i - 1;
    }
    return path.slice(i + 1);
}

const dir = "tmp-3585-" + tail(process.argv[1] ?? "x");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(dir + "/a.txt", "hello");
mkdirSync(dir + "/sub");

// ── Stats ──────────────────────────────────────────────────────────────
function pickStats(on: boolean) {
    return on ? statSync(dir + "/a.txt") : undefined;
}
const st = pickStats(true);
console.log("isFile:", String(st?.isFile()));
console.log("isDirectory:", String(st?.isDirectory()));
console.log("isSymbolicLink:", String(st?.isSymbolicLink()));
const noStats = pickStats(false);
console.log("absent isFile:", String(noStats?.isFile()));
console.log("absent is undefined:", noStats?.isFile() === undefined);

const dirStats = statSync(dir + "/sub");
const maybeDirStats: typeof dirStats | undefined = dirStats;
console.log("dir isDirectory:", String(maybeDirStats?.isDirectory()));
console.log("dir isFile:", String(maybeDirStats?.isFile()));

// ── Dirent ─────────────────────────────────────────────────────────────
const entries = readdirSync(dir, { withFileTypes: true });
const names: string[] = [];
for (const e of entries) {
    const maybe: typeof e | undefined = e;
    names.push(e.name + "=" + String(maybe?.isFile()) + "/" + String(maybe?.isDirectory()));
}
names.sort();
console.log("dirents:", names.join(" "));

// ── FSWatcher: close() is void, statement position ─────────────────────
function pickWatcher(on: boolean) {
    return on ? watch(dir, () => {}) : undefined;
}
const w = pickWatcher(true);
w?.close();
// Idempotent, and the absent one is a no-op.
w?.close();
const noWatcher = pickWatcher(false);
noWatcher?.close();
console.log("watcher closed");

// ── the Timeout handle ─────────────────────────────────────────────────
const timer0 = setTimeout(() => {
    console.log("timer fired");
}, 1);
function pickTimer(on: boolean): typeof timer0 | undefined {
    return on ? timer0 : undefined;
}
const t = pickTimer(true);
console.log("hasRef:", String(t?.hasRef()));
t?.unref();
console.log("hasRef after unref:", String(t?.hasRef()));
t?.ref();
console.log("hasRef after ref:", String(t?.hasRef()));
const noTimer = pickTimer(false);
console.log("absent hasRef:", String(noTimer?.hasRef()));
noTimer?.unref();

// The DEFENSIVE optional call keeps its old meaning: the token is on the
// CALL, the method always exists, and this is the plain call.
const t2 = setTimeout(() => {
    console.log("timer 2 fired");
}, 1);
t2.unref?.();
console.log("t2 hasRef after defensive unref:", t2.hasRef());
t2.ref?.();

process.on("exit", () => {
    rmSync(dir, { recursive: true, force: true });
});
