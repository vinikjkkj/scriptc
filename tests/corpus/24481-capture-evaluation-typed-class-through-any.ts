function make(prefix: string, n: number) {
  class C {
    v = n;
    viaCapture(): string { return prefix + n; }
    withArg(x: string, y?: number): string { return prefix + x + (y ?? n); }
    viaBoth(): string { return prefix + this.v; }
    async am(): Promise<string> { await null; return prefix + n; }
    *gm(): Generator<string> { yield prefix; yield String(n); }
    arrow(): string { return [1, 2].map((q) => prefix + q + this.v).join(","); }
  }
  return new C();
}
function pick(o: any, k: string): any { return o[k]; }
const a = make("p", 1), b = make("q", 2);
const vc = pick(a, "viaCapture"), wa = pick(a, "withArg"), vb = pick(a, "viaBoth"), ar = pick(a, "arrow");
console.log(vc(), vc.call(b));
console.log(wa("-"), wa.call(b, "-", 5), wa.apply(b, ["+"]), wa.bind(b, "*")());
try { console.log(vb()); } catch (e: any) { console.log("T", e.name); }
console.log(vb.call(b));
try { console.log(ar()); } catch (e: any) { console.log("T", e.name); }
console.log(ar.call(b));
console.log(pick(a, "viaCapture") === vc, pick(b, "viaCapture") === vc, pick(make("p", 1), "viaCapture") === vc);
const aa: any = a;
console.log(aa.viaCapture === aa.viaCapture, aa.viaCapture === (b as any).viaCapture);
