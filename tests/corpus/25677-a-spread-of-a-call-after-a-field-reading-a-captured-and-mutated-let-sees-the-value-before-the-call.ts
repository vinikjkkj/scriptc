// Negative control for the hoist of a spread's call result: the field before the spread reads a `let` that a closure mutates, and the spread's call runs that closure. JS evaluates
// the field first, so it holds the value BEFORE the call; the call's own keys follow. A hoist that ran the call first would show the mutated value.
interface Row { before: number; after: number; label: string; status: string }
class Api {
  log: string[] = [];
  bump: () => void = () => {};
  outcome(tag: string): { status: string; label?: string } {
    this.log.push("call " + tag);
    this.bump();
    return { status: "done " + tag };
  }
}
function run(tag: string): Row {
  const api = new Api();
  let n = 1;
  api.bump = () => { n += 10; };
  const row = { before: n, after: 0, label: tag, ...api.outcome(tag) } as Row;
  row.after = n;
  console.log(api.log.join(","));
  return row;
}
console.log(JSON.stringify(run("a")));
console.log(JSON.stringify(run("b")));
