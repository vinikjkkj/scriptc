// The default is an `await`, and eager evaluation would be OBSERVABLE.
//
// zapo writes `prefetchedLocalKeyBundle ?? (await this.resolveFromStore())`.
// The helper this replaced took the default as an argument, so it would
// have awaited the store read on the path whose whole purpose is not to
// read the store. That is not a performance note: the store read below
// counts its calls and the count is part of the expected output.

interface Bundle {
    id: number;
}

let storeReads = 0;

async function fromStore(): Promise<Bundle | null> {
    storeReads += 1;
    await Promise.resolve();
    return { id: 9 };
}

async function resolve(pre: Bundle | undefined): Promise<Bundle | null> {
    return pre ?? (await fromStore());
}

// A second shape: the awaited default sits under a union with a DIFFERENT
// arm set from the left's, so the non-nullish path re-tags rather than
// passing the box through.
async function widen(pre: string | undefined): Promise<string | number> {
    return pre ?? (await Promise.resolve(41));
}

async function main(): Promise<void> {
    console.log(JSON.stringify(await resolve({ id: 1 })), storeReads);
    console.log(JSON.stringify(await resolve(undefined)), storeReads);
    console.log(JSON.stringify(await resolve({ id: 2 })), storeReads);
    console.log(await widen("present"));
    console.log(await widen(undefined));

    // Ordering: the left's own effects happen before the default's, and
    // the default's happen only on the nullish path.
    const order: string[] = [];
    const left = (v: string | null): string | null => {
        order.push("L");
        return v;
    };
    const right = async (): Promise<number> => {
        order.push("R");
        await Promise.resolve();
        return 3;
    };
    const a: string | number = left("x") ?? (await right());
    const b: string | number = left(null) ?? (await right());
    console.log(a, b, order.join(","));
}

void main();
