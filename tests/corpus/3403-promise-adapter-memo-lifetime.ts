// The lifetime of a promise payload-conversion memo.
//
// A memo is a retained reference by definition: the source promise owns
// the adapted one, so a program that converts a great many short-lived
// promises must still hand every one of them back. Under SCRIPTC_RC_AUDIT
// (or SCRIPTC_SAN) this file is the leak test — the accounting is what
// matters, and the printed output only proves the work happened.
//
// Three shapes, because they retire differently: a source dropped while
// its adaptation is still held, an adaptation dropped while its source is
// still held, and both dropped together.
async function mk(n: number): Promise<string> {
    return "v" + String(n);
}

const CYCLES = 200;

async function sourceDiesFirst(): Promise<number> {
    // The map keeps the ADAPTED promise; each source goes out of scope at
    // the end of its iteration.
    const held = new Map<string, Promise<unknown>>();
    for (let i = 0; i < CYCLES; i = i + 1) {
        const p = mk(i);
        held.set("k" + String(i % 8), p);
        if (i % 8 === 7) {
            held.clear();
        }
    }
    const n = held.size;
    held.clear();
    return n;
}

async function adaptedDiesFirst(): Promise<string> {
    // The SOURCES are held; the adaptations are made and dropped inside
    // the loop. A source that already has an entry answers with it, so the
    // list on each source stays exactly one long.
    const sources: Promise<string>[] = [];
    for (let i = 0; i < 16; i = i + 1) {
        sources.push(mk(i));
    }
    const m = new Map<string, Promise<unknown>>();
    let hits = 0;
    for (let i = 0; i < CYCLES; i = i + 1) {
        const src = sources[i % 16]!;
        m.set("one", src);
        if (m.get("one") === src) {
            hits = hits + 1;
        }
        m.clear();
    }
    let joined = "";
    for (const s of sources) {
        joined = joined + (await s).slice(1);
    }
    return String(hits) + "/" + String(joined.length);
}

async function bothDie(): Promise<number> {
    let same = 0;
    for (let i = 0; i < CYCLES; i = i + 1) {
        const p = mk(i);
        const m = new Map<string, Promise<unknown>>();
        m.set("k", p);
        if (m.get("k") === p) {
            same = same + 1;
        }
        // Two more conversions of the same source, one of them into a
        // different destination: two entries, both to be reclaimed.
        const opt = new Map<string, Promise<string | undefined>>();
        opt.set("k", p);
        if (opt.get("k") === p) {
            same = same + 1;
        }
        await p;
    }
    return same;
}

async function main(): Promise<void> {
    console.log("source dies first:", await sourceDiesFirst());
    console.log("adapted dies first:", await adaptedDiesFirst());
    console.log("both die:", await bothDie());
}

void main();
