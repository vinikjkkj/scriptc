// The getter and setter of an object literal run against the very object they were read from.
const counter = {
  count: 3,
  get next() { return counter.count + 1; },
  set next(v: number) { counter.count = v - 1; },
};
const d: any = Object.getOwnPropertyDescriptor(counter, "next");
console.log(d.get.call(counter), d.get.name, d.set.name, d.enumerable, d.configurable);
d.set.call(counter, 10);
console.log(counter.count, counter.next);
const typed = Object.getOwnPropertyDescriptor(counter, "next")!;
console.log(typed.get!.call(counter), typed.set!.name);
