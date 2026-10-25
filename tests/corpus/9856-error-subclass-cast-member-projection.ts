// An Error subclass with a field and a method, read through a structural cast.
// Its record slots project, so the cast is accepted and both reads match Node.
class MyErr extends Error {
    readonly code2: number = 3;
    m(x: string): string {
        return x;
    }
}
const e = new MyErr("boom") as unknown as { m: (x: string) => string; code2: number };
console.log(e.m("a"), e.code2);
