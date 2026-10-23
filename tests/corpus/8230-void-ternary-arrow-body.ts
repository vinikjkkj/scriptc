// A concise arrow whose body is a conditional with two void arms is a branch
// spelled as an expression: promise executors write
// `(err, r) => (err ? reject(err) : resolve(r))` this way. The value is
// discarded, so exactly one arm runs, exactly once.
function a(x: number): void {
  console.log("a", x);
}
function b(x: number): void {
  console.log("b", x);
}
const f = (c: boolean) => (c ? a(1) : b(2));
f(true);
f(false);

const settle = (fail: boolean): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const done = (err: Error | null, v: string): void => (err ? reject(err) : resolve(v));
    done(fail ? new Error("failed") : null, "ok");
  });
settle(false).then((v) => console.log("resolved", v));
settle(true).catch((e: unknown) => console.log("rejected", e instanceof Error ? e.message : "?"));
