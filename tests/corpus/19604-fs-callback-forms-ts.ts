// Corpus 19604: the fs.open, fs.write, fs.close and fs.chmod callback forms in
// TypeScript, typed by the declared overloads. Chained one loop turn at a
// time in a private mkdtemp directory; no path, errno or OS text is printed.
import * as fs from "node:fs";
import * as os from "node:os";

const D: string = fs.mkdtempSync(os.tmpdir() + "/fscb-19604-");
const F: string = D + "/t.txt";
const jobs: Array<(next: () => void) => void> = [];
const step = (f: (next: () => void) => void): void => {
  jobs.push(f);
};
let fd: number = -1;

step((next) => {
  fs.open(F, "w+", 0o600, (e: NodeJS.ErrnoException | null, n: number) => {
    console.log("open", e === null, n >= 0);
    fd = n;
    next();
  });
});
step((next) => {
  fs.write(fd, Buffer.from("0123456789"), 2, 5, 1, (e: NodeJS.ErrnoException | null, n: number, b: Buffer) => {
    console.log("write-buf", e === null, n, b.length);
    next();
  });
});
step((next) => {
  fs.write(fd, "tail", 8, "utf8", (e: NodeJS.ErrnoException | null, n: number, s: string) => {
    console.log("write-str", e === null, n, s);
    next();
  });
});
step((next) => {
  fs.write(fd, "Z", (e: NodeJS.ErrnoException | null, n: number) => {
    console.log("write-cur", e === null, n);
    next();
  });
});
step((next) => {
  fs.write(fd, Buffer.from("xy"), (e: NodeJS.ErrnoException | null, n: number) => {
    console.log("write-two-arg", e === null, n);
    next();
  });
});
step((next) => {
  fs.close(fd, (e: NodeJS.ErrnoException | null) => {
    console.log("close", e === null);
    next();
  });
});
step((next) => {
  console.log("contents", JSON.stringify(fs.readFileSync(F, "utf8")));
  next();
});
step((next) => {
  fs.chmod(F, 0o644, (e: NodeJS.ErrnoException | null) => {
    console.log("chmod", e === null);
    next();
  });
});
step((next) => {
  fs.chmod(D + "/none", 0o644, (e: NodeJS.ErrnoException | null) => {
    console.log("chmod-missing", e === null ? "null" : `${e.code} ${e.syscall}`);
    next();
  });
});
step((next) => {
  fs.close(987654, (e: NodeJS.ErrnoException | null) => {
    console.log("close-bad", e === null ? "null" : `${e.code} ${e.syscall}`);
    next();
  });
});

const run = (): void => {
  const j = jobs.shift();
  if (j === undefined) {
    fs.rmSync(D, { recursive: true, force: true });
    console.log("main end");
    return;
  }
  j(run);
};
run();
