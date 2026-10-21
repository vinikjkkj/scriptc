interface User { name: string; age: number }
const log: string[] = [];
const user: User = { name: "ann", age: 30 };
const checked = new Proxy(user, {
  get(target: User, prop: string | symbol, receiver: unknown) {
    log.push("get " + String(prop));
    return Reflect.get(target, prop, receiver);
  },
  set(target: User, prop: string | symbol, value: unknown): boolean {
    if (prop === "age" && typeof value !== "number") throw new TypeError("age must be a number");
    log.push("set " + String(prop));
    return Reflect.set(target, prop, value);
  },
});
console.log(checked.name, checked.age);
checked.age = 31;
try { (checked as any).age = "x"; } catch (e) { console.log((e as Error).message); }
console.log(checked.age, log.join(","));
