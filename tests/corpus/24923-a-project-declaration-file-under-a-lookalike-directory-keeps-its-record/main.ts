// A project's own declaration files under directories whose names merely resemble a package layout ("npm-trees", "node_modules_x") are not packages:
// their interfaces keep their record, so the object literals with generic arrows fill them (a dyn remap refused these with SC1090).
import type { Finder } from "./dd/npm-trees/store";
import type { Other } from "./dd/node_modules_x/other";
const f: Finder = {
  find: <T extends string>(key: T, ...more: [T, ...string[]]): T => key,
  hit: (id: number): boolean => id > 2,
};
const o: Other = {
  pick: <T extends string>(key: T, ...more: [T, ...string[]]): T => key,
  size: (id: number): number => id * 2,
};
console.log(f.hit(3), f.hit(1), f.find("a", "a"), o.size(4), o.pick("b", "b"));
