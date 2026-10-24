import type { Finder } from "./dd/store";
function run(f: Finder): void {
  console.log(f.hit(3), f.hit(1));
}
const f: Finder = {
  find: <T extends string>(key: T, ...more: [T, ...string[]]): T => key,
  hit: (id: number): boolean => id > 2,
};
run(f);
