// split splices each capture group's text into the result; a group that may not participate is undefined in
// Node's array, which a string[] cannot hold, so the pattern is refused at build time (a group that always
// participates, or a non-capturing group, compiles).
console.log("a1b".split(/(\d)|(x)/));
console.log("a,b".split(/(,)?/));
console.log("a,b".split(/(,)/), "a,b".split(/(?:,)/));
