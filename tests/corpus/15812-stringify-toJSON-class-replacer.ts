// A class instance with toJSON inside a dyn tree: the hook runs, the replacer
// sees its answer, and the gap formats the result.
class Money {
  amount: number;
  constructor(n: number) { this.amount = n; }
  toJSON(): unknown { return { cents: this.amount * 100 }; }
}
const holder: unknown = { m: new Money(3), nums: [1.5, -0] };
console.log(JSON.stringify(holder, (k: string, v: unknown) => v));
console.log(JSON.stringify(holder, null, 2));
