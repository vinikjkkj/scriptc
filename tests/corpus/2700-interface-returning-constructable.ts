// A constructable whose instance type is an INTERFACE rather than a program
// class -- `new (url: string) => Sock`, the injection point a transport
// keeps so a test can supply its own socket.
//
// Constructor-signature types already mapped when the return was a program
// class instance (classval of that class). With an interface return there
// is no class to name, so the slot did not map at all -- and an OPTIONAL
// member nothing sets took its whole record down with it, and every class
// holding that record after it.
//
// A constructor IS a callable producing the instance, so the slot maps to
// that function type. Both spellings reach it: `type C = new (…) => T` is a
// constructor TYPE node, `interface C { new (…): T }` a construct
// SIGNATURE.
//
// The VALUE side stays shut, and deliberately: `new c(url)` through such a
// slot still fences with "constructing values other than classes declared
// in the program". This opens the type so the records compile, not the
// construction.

interface Sock { readonly readyState: number; close(): void }
type SockCtor = new (url: string) => Sock;
interface Cfg { readonly url: string; readonly sockCtor?: SockCtor }
class Comms {
  readonly cfg: Readonly<Cfg>;
  constructor(c: Readonly<Cfg>) { this.cfg = c; }
  describe(): string { return this.cfg.url; }
}
const c = new Comms({ url: "wss://x" });
console.log(c.describe());
