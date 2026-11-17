// A throw Node raises at module evaluation is observable even when the binding is never read: the initializer is kept, the program stops there
// (the lines after it never run) and exits with the failure status.
console.log("before");
export const NEVER_READ = JSON.parse("{ not json");
console.log("after");
