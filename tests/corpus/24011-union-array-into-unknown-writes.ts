// An array of unions handed to an untyped parameter is ONE array: the callee's index writes, push, pop,
// reverse, splice, sort and length writes land on the caller's array, and a record arm is the caller's object.
interface Item { k: number }
function edit(a: unknown[]): number {
  a[0] = 99;
  a.push("pushed");
  a.pop();
  a.push(7);
  a.reverse();
  a.splice(1, 1);
  return a.length;
}
const xs: (string | number)[] = [1, "b", 3, "d"];
console.log(edit(xs), xs, xs.length);
function ord(a: unknown[]): void { a.sort(); a.length = 2; }
const ys: (string | number)[] = ["c", "a", "b"];
ord(ys);
console.log(ys);
function bump(a: unknown[]): void {
  (a[0] as Item).k += 10;
  a.push({ k: 3 });
}
const rs: (Item | string)[] = [{ k: 1 }, "s"];
bump(rs);
console.log(rs, JSON.stringify(rs), rs.length);
