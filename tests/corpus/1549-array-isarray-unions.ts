// Array.isArray on UNION-typed values answers by the runtime tag: true iff
// the active arm is an array kind — the narrowing test tsc's control flow
// then builds on (the certs `string | readonly string[]` and tailscale
// `string[] | undefined` idioms).
function names(tlds: string | string[]): string {
  const configured: string[] = Array.isArray(tlds) ? tlds : [tlds];
  return configured.join(",");
}
console.log(names("localhost"));
console.log(names(["a.test", "b.test"]));
console.log(names([]));

// readonly arrays ride the same tag test (tsc's own narrowing answers
// `any[]` around an `arg is any[]` guard on readonly unions, so the
// branches read nothing here — the certs SNICallback idiom's shape).
function isList(tlds: string | readonly string[]): boolean {
  return Array.isArray(tlds);
}
console.log(isList(["x.test", "y.test"]));
console.log(isList("bare"));

function hasHttps(capabilities: string[] | undefined): boolean {
  if (Array.isArray(capabilities) && capabilities.some((c) => c === "https")) {
    return true;
  }
  return false;
}
console.log(hasHttps(undefined));
console.log(hasHttps(["ssh", "https"]));
console.log(hasHttps(["ssh"]));

// The negated spelling narrows the else way around.
function total(value: number | number[]): number {
  if (!Array.isArray(value)) return value;
  let sum = 0;
  for (const n of value) sum += n;
  return sum;
}
console.log(total(7));
console.log(total([1, 2, 3]));

// Zero array arms fold to constant false; a union of two array kinds
// answers true for both.
const scalar: string | number = "text" as string | number;
console.log(Array.isArray(scalar));
const mixed: string[] | number[] | undefined = [3, 4] as string[] | number[] | undefined;
console.log(Array.isArray(mixed));
const missing: string[] | number[] | undefined = undefined;
console.log(Array.isArray(missing));
