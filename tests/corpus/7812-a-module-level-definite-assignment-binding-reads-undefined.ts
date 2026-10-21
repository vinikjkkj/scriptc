// A module-level `let x!: T` read from a function before the module assigns it.
let gs!: string; let gn!: number; let go!: {id: number};
function show() { console.log(gs, gn, go, typeof gs, gs === undefined, `${gs}`); }
show();
try { console.log(gs.length); } catch (e) { console.log((e as Error).message); }
gs = "a"; gn = 2; go = {id: 1};
show(); console.log(gs.length, gn + 1, go.id);
