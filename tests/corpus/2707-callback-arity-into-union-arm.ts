// A callback with FEWER parameters assigned into a nullable callback slot:
// `socket.onopen = () => {…}` against `((e: Event) => void) | null`, which
// is how a transport installs its handlers on a raw socket. JS simply does
// not pass the argument the callback ignores.
//
// The adapter that makes the signatures meet already existed (funcAdapt),
// and the union path already asks widthLiftPlan — the pair only ever
// lacked a FAMILY in liftWrap's candidate rule, which listed record/array/
// object pairs and no func. So an exact-signature callback reached the arm
// and an arity-adapted one did not.
//
// The candidate rule's ambiguity guard is unchanged: exactly one arm may
// accept the lift, so a union with two different function arms still
// declines rather than guessing.

type Ev = { readonly code: number };
type Sock = { onopen: ((e: Ev) => void) | null; onclose: ((e: Ev) => void) | null };
const s: Sock = { onopen: null, onclose: null };
// zero parametros num slot que espera um -- legal em JS/TS, e o que o
// WaWebSocket faz ao instalar handlers no socket cru.
s.onopen = () => { console.log("aberto"); };
s.onclose = (e) => { console.log("fechado", e.code); };
// invocacao por local estreitado (a lib e' quem chama, no caso real)
const open = s.onopen;
if (open !== null) open({ code: 0 });
const close = s.onclose;
if (close !== null) close({ code: 7 });
