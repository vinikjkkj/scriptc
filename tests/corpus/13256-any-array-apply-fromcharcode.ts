// An any[] of numbers as the argument list of String.fromCharCode.apply: a copy of its ToNumber values.
function encode(parts: number[]): string {
  let out: any = null;
  const codes: any[] = [72, "105", 33];
  for (const p of parts) {
    (out || (out = [])).push(String.fromCharCode.apply(String, codes));
  }
  return out ? out.join("|") : "";
}
console.log(encode([1, 2]));
console.log(JSON.stringify(encode([])));
