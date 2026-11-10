// The module namespace object an import() answers: null prototype, Module tag, sealed and not extensible, strict-mode [[Set]]/[[Delete]]/[[DefineOwnProperty]] TypeErrors, sorted keys, `in`, JSON order, and live bindings for a let written from a function.
import * as self from "./lib1.ts";
const ns: any = await import("./lib1.ts");
const t = (name: string, fn: () => unknown): void => {
  try { console.log(name, "->", String(fn())); } catch (e) { console.log(name, "THROW", (e as Error).constructor.name, (e as Error).message); }
};
t("proto", () => Object.getPrototypeOf(ns));
t("set a", () => { ns.a = 5; });
t("set new", () => { ns.zz = 5; });
t("delete a", () => delete ns.a);
t("delete zz", () => delete ns.zz);
t("keys", () => Object.keys(ns).join());
t("names", () => Object.getOwnPropertyNames(ns).join());
t("json", () => JSON.stringify(ns));
t("isFrozen", () => Object.isFrozen(ns));
t("isSealed", () => Object.isSealed(ns));
t("isExtensible", () => Object.isExtensible(ns));
t("tag", () => Object.prototype.toString.call(ns));
t("in a", () => "a" in ns);
t("in zz", () => "zz" in ns);
t("in toString", () => "toString" in ns);
t("hasOwn", () => Object.hasOwn(ns, "b"));
t("typeof", () => typeof ns);
t("entries", () => JSON.stringify(Object.entries(ns)));
t("live", () => { ns.bump(); return String(ns.a); });
t("defineProperty a", () => Object.defineProperty(ns, "a", { value: 3 }));
t("defineProperty new", () => Object.defineProperty(ns, "zz", { value: 3 }));
t("tag sym", () => ns[Symbol.toStringTag]);
t("values", () => JSON.stringify(Object.values(ns)));
const keep = ns;
t("passed", () => ((o: any) => o.b)(ns));
t("same obj", () => keep === ns);
