// No import and no export, but the package scope (tests/corpus/package.json)
// is "type": "module": Node loads this .ts as an ES module, so the promise
// job runs BEFORE the body's nextTick. Syntax alone would call it CommonJS.
process.nextTick(() => console.log("main-tick"));
Promise.resolve().then(() => console.log("main-micro"));
console.log("sync");
