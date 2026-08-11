// A promise-dedup map, verbatim from a WhatsApp client's `PromiseDedup`,
// at five instantiations at once.
//
// The class is eight lines and every one of them is load-bearing. In
// flight, a second caller for the same key receives the first task's
// promise and the task runs ONCE. After it settles, the `.finally` guard
//
//     if (this.inFlight.get(key) === created) { this.inFlight.delete(key) }
//
// evicts the entry — but `inFlight` is a `Map<string, Promise<unknown>>`
// and `created` is a `Promise<T>`, so the comparison spans a payload
// conversion. Answer it wrongly and the guard is false on every run, the
// map never evicts, and every later caller of a key gets the FIRST task's
// settled value forever. Nothing about that is visible from the outside
// except the `calls:` counters below, which is why they are counted rather
// than described.
class PromiseDedup {
    private readonly inFlight = new Map<string, Promise<unknown>>();

    public run<T>(key: string, task: () => Promise<T>): Promise<T> {
        const existing = this.inFlight.get(key);
        if (existing) {
            return existing as Promise<T>;
        }
        const created = Promise.resolve()
            .then(() => task())
            .finally(() => {
                if (this.inFlight.get(key) === created) {
                    this.inFlight.delete(key);
                }
            });
        this.inFlight.set(key, created);
        return created;
    }
}

interface Device {
    deviceJids: string[];
    jid: string;
}

const dedup = new PromiseDedup();

async function main(): Promise<void> {
    // <string>: in-flight sharing, then eviction, then a second run.
    let calls = 0;
    const a = dedup.run<string>("s", async () => {
        calls = calls + 1;
        return "v" + String(calls);
    });
    const b = dedup.run<string>("s", async () => {
        calls = calls + 1;
        return "v" + String(calls);
    });
    console.log("in flight:", await a, await b, "calls:", calls);
    const c = dedup.run<string>("s", async () => {
        calls = calls + 1;
        return "v" + String(calls);
    });
    console.log("after eviction:", await c, "calls:", calls);

    // Two keys never share, in flight or after.
    const k1 = dedup.run<string>("k1", async () => "one");
    const k2 = dedup.run<string>("k2", async () => "two");
    console.log("two keys:", await k1, await k2);

    // <void>: the payload the guard has the least to hold on to.
    let voids = 0;
    await dedup.run<void>("v", async () => {
        voids = voids + 1;
    });
    await dedup.run<void>("v", async () => {
        voids = voids + 1;
    });
    console.log("void:", voids);

    // <string[]>
    const l1 = await dedup.run<string[]>("l", async () => ["a", "b"]);
    const l2 = await dedup.run<string[]>("l", async () => ["c"]);
    console.log("array:", l1.join(","), l2.join(","));

    // <Device[]> — a device-list dedup, the instantiation whose staleness
    // a WhatsApp client would carry for the life of the process.
    const d1 = await dedup.run<Device[]>("d", async () => [{ deviceJids: ["x"], jid: "j1" }]);
    const d2 = await dedup.run<Device[]>("d", async () => [{ deviceJids: ["y"], jid: "j2" }]);
    console.log("devices:", d1[0]!.jid, d2[0]!.jid);

    // <{ keyHash: Uint8Array; timestamp: number | undefined }> — a payload
    // carrying a typed-array LEAF, which the structural conversion has to
    // walk field by field.
    const u1 = await dedup.run<{ keyHash: Uint8Array; timestamp: number | undefined }>(
        "u",
        async (): Promise<{ keyHash: Uint8Array; timestamp: number | undefined }> => ({
            keyHash: new Uint8Array([1, 2, 3]),
            timestamp: 7,
        }),
    );
    const u2 = await dedup.run<{ keyHash: Uint8Array; timestamp: number | undefined }>(
        "u",
        async (): Promise<{ keyHash: Uint8Array; timestamp: number | undefined }> => ({
            keyHash: new Uint8Array([9]),
            timestamp: undefined,
        }),
    );
    console.log("bytes:", u1.keyHash[0], u1.keyHash[2], u1.timestamp);
    console.log("bytes again:", u2.keyHash[0], u2.keyHash.length, u2.timestamp);

    // A rejecting task evicts too, and the rejection reaches the caller
    // rather than the adapter.
    let boom = 0;
    for (let i = 0; i < 2; i = i + 1) {
        try {
            await dedup.run<string>("bad", async () => {
                boom = boom + 1;
                throw new Error("nope " + String(boom));
            });
            console.log("unreachable");
        } catch (e) {
            console.log("caught:", (e as Error).message);
        }
    }
    console.log("rejecting task ran:", boom);
}

await main();
