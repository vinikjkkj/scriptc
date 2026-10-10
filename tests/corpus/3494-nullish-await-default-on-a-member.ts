// The `??` LEFT IS A MEMBER ACCESS, and that is the whole difference from
// 3492.
//
// zapo-js writes `args.iv ?? (await randomBytesAsync(APP_STATE_IV_LENGTH))`
// (WaAppStateCrypto.encryptMutation). 3492 covers the awaited default; every
// `??` left in it is a bare local, so nothing is retained for the test and
// nothing is released afterwards. A MEMBER access retains its receiver before
// the branch and releases it in the JOIN -- which puts a use of a pre-park
// value in a block both arms reach, one of them without ever passing the
// resume label.
//
// On the stackless lane that use is rewritten into the resume block's reload,
// and the reload does not define it on the arm that never parked. Seven of
// app182's functions were rejected by `zig cc` for exactly this, including
// this one:
//
//     Instruction does not dominate all uses!
//       %cx0_t114 = load ptr, ptr %cxr0_t114, align 8
//       call void @sc_rrelease_r134(ptr %cx0_t114)
//
// The output below is ordinary; the program is a BUILD test first. It still
// checks the values, because a repair that carried the wrong value would
// build clean and print the wrong bytes.

interface Args {
    iv: string | null;
    tag: string;
}

let defaults = 0;

async function makeDefault(): Promise<string> {
    defaults += 1;
    await Promise.resolve();
    return "generated";
}

// The app182 shape: a member read as the `??` left, an await as the default,
// and the receiver used again after the join.
async function encrypt(args: Args): Promise<string> {
    const iv = args.iv ?? (await makeDefault());
    return `${args.tag}:${iv}`;
}

// The same, with the receiver reached through a second level so the retain is
// taken on a temporary rather than on a local.
interface Outer {
    inner: Args;
}

async function nested(o: Outer): Promise<string> {
    const iv = o.inner.iv ?? (await makeDefault());
    return `${o.inner.tag}/${iv}`;
}

// A member `??` whose join is also an exception landing pad: the release of
// the receiver sits in the join AND in the throwing arm.
async function mayThrow(args: Args, boom: boolean): Promise<string> {
    const iv = args.iv ?? (await makeDefault());
    if (boom) {
        throw new Error(`boom ${args.tag}`);
    }
    return `${args.tag}=${iv}`;
}

async function main(): Promise<void> {
    console.log(await encrypt({ iv: "present", tag: "A" }), defaults);
    console.log(await encrypt({ iv: null, tag: "B" }), defaults);
    console.log(await nested({ inner: { iv: "inner", tag: "C" } }), defaults);
    console.log(await nested({ inner: { iv: null, tag: "D" } }), defaults);
    console.log(await mayThrow({ iv: "x", tag: "E" }, false), defaults);
    try {
        await mayThrow({ iv: null, tag: "F" }, true);
        console.log("no throw");
    } catch (e) {
        console.log("caught", (e as Error).message, defaults);
    }
}

void main();
