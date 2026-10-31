class Dummy {}
try { JSON.parse("null").x; } catch (e) { console.log("name", e.name); console.log("ctorname", e.constructor.name); }
console.log("dummy", new Dummy().constructor.name);
