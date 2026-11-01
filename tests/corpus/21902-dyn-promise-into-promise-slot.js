// An untyped promise flowing into a Promise-typed parameter: the value is
// checked to be a promise and its payload converts to the declared element type,
// including a settle-or-null payload of tuples.
/** @param {Promise<number>} p @returns {Promise<string>} */
function take(p) { return p.then((v) => "got " + v); }
/** @param {Promise<number>} p */
function rej(p) { return p.catch((e) => "caught " + e.message); }
/** @param {Promise<[null | Error, unknown][] | null | undefined>} p @param {() => void} cb */
function settle(p, cb) { return p.then((r) => { cb(); return r; }); }
function id(v) { return v; }
take(id(Promise.resolve(7))).then((s) => console.log(s));
rej(id(Promise.reject(new Error("no")))).then((s) => console.log(s));
take(id(Promise.resolve(8))).then((s) => console.log("again", s));
const exec = id(Promise.resolve([[null, "OK"], [null, 3]]));
settle(exec, () => console.log("cb")).then((r) => console.log(Array.isArray(r) ? r.length : String(r)));
settle(id(Promise.resolve(null)), () => console.log("cb2")).then((r) => console.log(r));
console.log("sync end");
