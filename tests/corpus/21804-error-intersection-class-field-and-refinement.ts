// A user class that extends Error declares `errors` itself; the refinement names the same member.
// The reads are admitted by the guard, which checks both refinement members.
class AggErr extends Error {
  errors: Error[];
  constructor(errors: Error[], msg: string) {
    super(msg);
    this.errors = errors;
  }
}
type Extended = Error & { errors: Error[]; extra: number };
function isExtended(e: unknown): e is Extended {
  return e instanceof Error && Array.isArray((e as unknown as { errors: unknown }).errors) &&
    typeof (e as unknown as { extra: unknown }).extra === 'number';
}
const x = new AggErr([new Error('q')], 'many') as Extended;
x.extra = 7;
const v: unknown = x;
if (isExtended(v)) console.log(v.message, v.errors.length, v.extra);
const d: any = v;
console.log(d.errors[0].message);
