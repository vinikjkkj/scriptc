// Number and Boolean passed as function values to an untyped array's methods: ToNumber and ToBoolean over objects, arrays, strings,
// null, undefined and class instances (valueOf, toString).
class Money { cents: number; constructor(cents: number) { this.cents = cents; } valueOf(): number { return this.cents; } }
class Named { n: string; constructor(n: string) { this.n = n; } toString(): string { return "N:" + this.n; } }
const a: any[] = [1, "12", { k: 1 }, [2], [], [5, 6], null, undefined, true, false, "", " 7 ", "abc", NaN, new Money(300), new Named("x"), { valueOf() { return 9; } }, "0x10", "1e3", "-0"];
console.log(a.map(Number).join("|"));
console.log(a.map(Boolean).join("|"));
console.log(a.filter(Boolean).length, a.some(Boolean), a.every(Boolean));
console.log(a.filter(Number).length);
