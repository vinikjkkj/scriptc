type Tag = { id: number };

const t1: Tag = { id: 1 };
const names = new WeakMap<Tag, string>();
names.set(t1, "one");
const flags = new WeakMap<Tag, boolean>();
flags.set(t1, true);
console.log(names, flags);
console.log(names.get(t1), flags.get(t1));
