// The earlier fields are pure combinators of constants (ternary, ||, !): the spread's call is hoisted and runs once per literal.
let runs = 0;
function tail(n: number): { x: number; y?: string } {
  runs += 1;
  return n > 1 ? { x: n, y: "big" } : { x: n };
}
interface Item { id: string; flag: boolean; label: string; x: number; y?: string }
function make(n: number, name: string): Item {
  const id = name;
  const hot = n > 1;
  return {
    id,
    flag: !hot,
    label: hot ? "hot" : id || "none",
    ...tail(n)
  };
}
console.log(JSON.stringify(make(1, "a")), JSON.stringify(make(2, "b")), runs);
