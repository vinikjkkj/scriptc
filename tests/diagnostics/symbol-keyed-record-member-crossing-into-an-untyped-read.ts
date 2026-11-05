// A record literal with a symbol-keyed member converted to an untyped value, in a program that reads symbol-keyed
// properties of untyped values: the read cannot match the member by identity, so the program is refused at the crossing.
const K = Symbol.for("@@test.version");
function version(doc: any): unknown {
  return doc[K];
}
console.log(version({ name: "x", [K]: 7 }));
