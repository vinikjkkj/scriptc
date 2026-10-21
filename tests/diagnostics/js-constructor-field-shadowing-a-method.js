// REFUSED AT COMPILE TIME (no --best-effort, no runtime fence): this was
// tests/corpus/2616-js-collect-probe-defers.js, a program that used to build and
// throw its fence when the statement ran. See the snapshot for the diagnostics.
// The collect-time classification probes (trap/nullish/dead) resolve
// initializer symbols; that resolution must NOT flush a reached
// declaration's DEFERRED collection diagnostics onto the build. At
// 0.0.10 the probe on `const i = new B()` flushed B's deferred
// "constructor-assigned fields shadowing methods" fence eagerly, failing
// this JS build at compile time where the JS-input design defers the
// fence to runtime (checkJsFiles_noErrorLocation / multipleDeclarations /
// jsdocTemplateClass corpus regressions). The fenced constructor never
// runs here, so the compiled binary matches Node.
class A {
  constructor() {}
  foo() {
    return 4;
  }
}
class B extends A {
  constructor() {
    super();
    this.foo = () => 3;
  }
}
const make = process.env.SCRIPTC_NEVER === "yes";
if (make) {
  const i = new B();
  console.log("got", i.foo());
}
console.log("done");
