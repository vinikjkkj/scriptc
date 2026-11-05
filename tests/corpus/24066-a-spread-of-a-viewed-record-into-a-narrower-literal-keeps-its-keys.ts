// A spread of a record that another conversion made a view, into a narrower literal, copies the object's own keys; an assignment to the narrower type and the spread agree.
interface Wide { readonly a: string; readonly b: string; readonly extra: string }
interface Narrow { readonly a: string; readonly b: string }
interface Small { readonly a: string }
const wide: Wide = { a: "A", b: "B", extra: "X" };
const narrow: Narrow = wide;
console.log(Object.keys(narrow).join("|"));
const small: Small = { ...wide };
let seen = "";
for (const k in small) {
  seen = seen + k + ";";
}
console.log(seen);
console.log(Object.keys(small).join("|"), JSON.stringify(small));
