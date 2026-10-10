// THE JOIN IS NOT REACHED FROM THE ENTRY ARM -- it is reached from an EARLIER
// RESUME LABEL, and that is the half 3494 does not cover.
//
// 3494's `??` sits before any other suspension, so the arm that does not park
// runs on the entry call and the join is reachable from `sc_S0`. Put two
// awaits in front of it and the same join becomes reachable from `sc_S2`
// instead: the dispatch enters there directly, flows to the non-parking arm,
// and lands in the join without ever passing `sc_S3` -- where the carry put
// its reload.
//
// A check that asked "can the ENTRY arm reach this use" answers no here and
// passes the body. zapo-js's WaRetryCoordinator.prepareDecryptFailureRetry is
// this shape (a ternary whose true arm awaits, after two earlier awaits) and
// `zig cc` rejected it with six of these:
//
//     Instruction does not dominate all uses!
//       %cx2_t396 = load ptr, ptr %cxr2_t396, align 8
//       call void @sc_rrelease_r1302(ptr %cx2_t396)
//
// so the question the carry has to answer is DOMINANCE and not reachability.

interface Box {
    tag: string;
    seen: number;
}

async function step(n: number): Promise<number> {
    await Promise.resolve();
    return n;
}

// Two awaits, then a value, then a ternary that parks on ONE arm, then a use
// of that value in the join.
async function ternary(cond: boolean): Promise<string> {
    const a = await step(1);
    const b = await step(2);
    const box: Box = { tag: "T", seen: a + b };
    const v = cond ? await step(3) : 0;
    return `${box.tag}:${box.seen}:${v}`;
}

// The same depth with a `??` rather than a ternary, so the two lowerings are
// both covered past an earlier resume label.
async function nullish(pre: string | null): Promise<string> {
    await step(1);
    await step(2);
    const box: Box = { tag: "N", seen: 7 };
    const got = pre ?? (await step(9)).toString();
    return `${box.tag}:${box.seen}:${got}`;
}

// A loop puts a BACK EDGE across the same join, which is the shape the
// emission-ordinal rule is documented to be blind to.
async function looped(rounds: number): Promise<string> {
    const parts: string[] = [];
    for (let i = 0; i < rounds; i += 1) {
        await step(i);
        const box: Box = { tag: `L${i}`, seen: i };
        const v = i % 2 === 0 ? await step(i * 10) : -1;
        parts.push(`${box.tag}/${box.seen}/${v}`);
    }
    return parts.join(",");
}

async function main(): Promise<void> {
    console.log(await ternary(true));
    console.log(await ternary(false));
    console.log(await nullish("given"));
    console.log(await nullish(null));
    console.log(await looped(3));
}

void main();
