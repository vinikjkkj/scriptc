// Calling a record's FUNCTION member while omitting a trailing optional
// parameter. Every other call-through-a-value path completes the missing
// argument with the undefined arm; this one did not, so the node reached the
// lib boundary one argument short and fenced on its own arity.
interface Logger {
  child(bindings: { readonly scope: string }, extra?: string): Logger;
  info(msg: string): void;
}
function mk(tag: string): Logger {
  return {
    child: (b, extra) => mk(tag + "/" + b.scope + (extra ?? "")),
    info: (m) => console.log(tag, m),
  };
}
const root = mk("root");
const direct = root.child({ scope: "store" });
direct.info("plain");
const withExtra = root.child({ scope: "s" }, "!");
withExtra.info("two args");
