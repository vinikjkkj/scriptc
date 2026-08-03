// STATIC-tier `import()` of a bare npm specifier with no static
// compilation in this build: the load has no compiled story, and
// import()'s failure channel is IN-BAND — the site compiles to a
// REJECTED promise carrying the pointed fence error, catchable at the
// await, which is exactly where Node surfaces its own load failures
// (the optional-dependency try/import pattern is built on that channel).
// The messages differ by design (Node: "Cannot find module ...", the
// compiled build: the fence naming --npm-static/--dynamic), so the case
// pins the SHAPE: an Error, naming the package, caught at the await.
export {}
const MISSING = 'this-package-is-not-installed'
try {
    await import(MISSING)
    console.log('loaded')
} catch (e) {
    const message = e instanceof Error ? e.message : ''
    console.log(e instanceof Error, message.includes('this-package-is-not-installed'))
}
