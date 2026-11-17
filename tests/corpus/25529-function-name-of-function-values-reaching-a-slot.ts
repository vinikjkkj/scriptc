// The name travels with the value: through a parameter, an array element, a record entry and a returned closure.
function foo() {}
const bar = () => 1;
function show(f: Function): string { return f.name; }
function pick(i: number): () => void { return [foo, () => {}, function qux() {}][i]!; }
function mk() { return () => 1; }
console.log(show(foo), show(bar), show(mk()) === "", show(function () {}) === "");
console.log(pick(0).name, pick(1).name === "", pick(2).name);
const list: Array<() => void> = [function a() {}, () => {}, function () {}];
console.log(list.map((f) => f.name).join("|"));
const arr = [foo, () => 1];
console.log(arr[0]!.name, arr[1]!.name === "");
