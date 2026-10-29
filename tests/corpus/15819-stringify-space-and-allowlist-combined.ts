// A PropertyList and a numeric gap together: the list picks and orders the
// members, the gap formats them, and nested objects outside the list are
// dropped entirely.
const doc: unknown = { id: 1, name: "n", meta: { id: 9, tags: ["t"] }, list: [{ id: 2, name: "m" }] };
console.log(JSON.stringify(doc, ["name", "id", "list"], 3));
console.log(JSON.stringify(doc, ["meta", "id"], "  "));
