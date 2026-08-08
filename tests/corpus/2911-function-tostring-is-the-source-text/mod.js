// The module edge the finding was reported against: a function created
// here, stringified over there.
export function crossEdge(a, b) { /* a comment survives */ return a + b; }

export function readsLater() { return later; }
export var later = function () { return "later ran"; };
