// bson's isMap: `Symbol.toStringTag in value && value[Symbol.toStringTag] === 'Map'` over an unknown value.
function isMap(value: unknown): boolean {
  return typeof value === "object" && value != null && Symbol.toStringTag in value && value[Symbol.toStringTag] === "Map";
}
function tagOf(value: unknown): unknown {
  return typeof value === "object" && value != null && Symbol.toStringTag in value ? value[Symbol.toStringTag] : "none";
}
console.log(isMap(new Map<string, number>()), isMap(new Set<string>()), isMap({}), isMap(null), isMap(new Uint8Array(1)), isMap([1]));
console.log(tagOf(new Set<string>()), tagOf({}), tagOf(new Uint8Array(2)), tagOf(Buffer.alloc(1)));
