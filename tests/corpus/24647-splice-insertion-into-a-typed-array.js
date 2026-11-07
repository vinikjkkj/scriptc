// A typed (non-dyn) array spliced WITH insertion links the runtime unit that holds the insertion form.
const a = [1, 2, 3];
a.splice(1, 0, 7);
console.log(a.join());
const s = ["a", "b", "c"];
s.splice(1, 1, "x", "y");
const removed = s.splice(0, 0, "first");
console.log(s.join(), removed.length);
