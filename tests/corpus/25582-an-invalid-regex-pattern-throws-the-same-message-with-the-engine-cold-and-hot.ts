// The error text of invalid dynamic patterns, before and after an engine use.
function attempt(p: string, flags?: string): string {
  try {
    const r = flags === undefined ? new RegExp(p) : new RegExp(p, flags);
    return "ok:" + r.source + "/" + r.flags;
  } catch (e) {
    const err = e as Error;
    // the text before the engine-specific reason: V8 and libregexp spell the reason differently, so only the prefix is Node-exact
    return err.name + ": " + err.message.slice(0, err.message.lastIndexOf(": "));
  }
}
const pats: [string, string?][] = [["("], ["a**"], ["[b-a]"], ["(?<n>a)(?<n>b)"], ["\\"], ["a{2,1}"], ["(?<=a"], ["x", "gg"], ["x", "z"], ["\\k<nope>", "u"], ["ok"]];
for (const [p, f] of pats) console.log("cold", JSON.stringify(p), f, attempt(p, f));
const noop: string = process.argv.length > 0 ? "return 5" : "";
console.log("engine", new Function(noop)());
for (const [p, f] of pats) console.log("hot", JSON.stringify(p), f, attempt(p, f));
