// Untyped receiver, unguarded call of a missing member: Node's TypeError text.
function run(o) { return o.hooks.onX(1); }
try { run({ hooks: {} }); console.log("no"); }
catch (e) { console.log(e.constructor.name, e.message); }
console.log(run({ hooks: { onX(v) { return v * 2; } } }));
