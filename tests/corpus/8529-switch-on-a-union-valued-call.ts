// A switch whose discriminant is a union-typed expression that is not a plain read
// (a call, an environment read) evaluates it once and tests the result in source order.
let calls = 0;
function mode(n: number): string | undefined {
  calls++;
  return n === 0 ? undefined : n === 1 ? "disable" : n === 2 ? "require" : "other";
}
function classify(n: number): string {
  switch (mode(n)) {
    case "disable":
      return "off";
    case "prefer":
    case "require":
      return "on";
    case undefined:
      return "unset";
  }
  return "default";
}
console.log(classify(0), classify(1), classify(2), classify(3), calls);
function envKind(): string {
  switch (process.env.SC_8529_UNSET_VARIABLE) {
    case "a":
      return "a";
    case "b":
      return "b";
  }
  return "none";
}
console.log(envKind());
