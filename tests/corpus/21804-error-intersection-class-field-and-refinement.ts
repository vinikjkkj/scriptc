// A user class that extends Error declares `errors` itself; the refinement names the same member.
class AggErr extends Error {
  errors: Error[];
  constructor(errors: Error[], msg: string) {
    super(msg);
    this.errors = errors;
  }
}
function g(): Error & { errors: Error[]; extra: number } {
  const x = new AggErr([new Error('q')], 'many') as Error & { errors: Error[]; extra: number };
  x.extra = 7;
  return x;
}
const v = g();
console.log(v.message, v.errors.length, v.extra);
const d: any = v;
console.log(d.errors[0].message);
