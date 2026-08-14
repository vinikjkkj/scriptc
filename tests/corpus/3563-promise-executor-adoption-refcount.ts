// The refcount lane for executor adoption.
//
// Adoption keeps a reference alive until something settles: the executor's
// settle capability holds the settle-or-value union, the union holds the
// adopted promise, and scr_promise_race_add parks a callback that owns a
// reference on the result promise. That is three live edges per adoption,
// created and torn down per loop pass here, over refcounted payloads and
// with the promise arm and the data arm alternating — the shape an RC audit
// has to see clean.
//
// It also pins the one case where nothing is supposed to settle: an
// executor that resolves with a promise that never settles leaves the
// result pending forever, exactly like JS, and the process still exits
// cleanly once the rest of the work is done. Node prints the same lines and
// exits 0 with that promise still pending.

type Row = { readonly id: number; readonly tag: string };

function row(i: number): Row {
    return { id: i, tag: `r${i}` };
}

function produce(i: number): Row | Promise<Row> {
    if (i % 3 === 0) {
        return row(i);
    }
    if (i % 3 === 1) {
        return Promise.resolve(row(i));
    }
    return new Promise<Row>((r) => {
        setTimeout(() => {
            r(row(i));
        }, 1);
    });
}

async function one(i: number): Promise<Row> {
    return await new Promise<Row>((res) => {
        res(produce(i));
    });
}

// Nested: the adopted promise is itself the result of an adoption.
async function nested(i: number): Promise<Row> {
    const inner: Row | Promise<Row> = one(i);
    return await new Promise<Row>((res) => {
        res(inner);
    });
}

async function main(): Promise<void> {
    const tags: string[] = [];
    for (let i = 0; i < 9; i++) {
        const r = await one(i);
        tags.push(r.tag);
    }
    console.log("flat", tags.join(","));

    const deep: string[] = [];
    for (let i = 0; i < 6; i++) {
        const r = await nested(i);
        deep.push(`${r.id}`);
    }
    console.log("nested", deep.join(","));

    // Strings, so the string payload path gets its own live-and-dead pass.
    let joined = "";
    for (let i = 0; i < 5; i++) {
        const s = await new Promise<string>((res) => {
            res(i % 2 === 0 ? `s${i}` : Promise.resolve(`p${i}`));
        });
        joined += s;
    }
    console.log("strings", joined);

    // Resolved with a promise that NEVER settles: this one stays pending
    // for the life of the process, and that is the correct answer.
    const forever = new Promise<string>((res) => {
        res(new Promise<string>(() => {}));
    });
    void forever;
    console.log("pending-left-behind ok");
}

void main();
