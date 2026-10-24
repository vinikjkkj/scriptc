interface Store {
  pick<T extends string>(key: T): T;
  pick(key: number): number;
}
const store: Store = {
  pick(key: string | number): any {
    if (typeof key === "number") return key * 2;
    return key + "!";
  },
};
function run(s: Store): void {
  console.log(s.pick("abc"));
  console.log(s.pick(21));
}
run(store);
