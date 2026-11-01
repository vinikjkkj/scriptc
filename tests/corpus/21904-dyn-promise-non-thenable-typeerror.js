// A checked-dynamic receiver that is not a thenable: then / catch / finally on
// it throw Node's TypeError, which try/catch observes at the call site.
function id(v) { return v; }
try { id(5).then((x) => x); } catch (e) { console.log(e.constructor.name, e.message); }
try { id({}).catch((x) => x); } catch (e) { console.log(e.constructor.name, e.message); }
try { id(null).finally(() => 1); } catch (e) { console.log(e.constructor.name, e.message); }
console.log("done");
