// A refinement's member is the same storage a dynamic view of the object reads.
class AggErr extends Error {
  errors: Error[];
  constructor(errors: Error[], msg: string) {
    super(msg);
    this.errors = errors;
  }
}
const d: any = new AggErr([new Error('one')], 'many');
console.log(d.message, d.errors.length);
const n: any = new Error('plain');
n.extra = 3;
const typed = n as Error & { extra: number };
console.log(typed.extra, d.errors[0].message);
