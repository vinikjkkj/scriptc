// `boolean` is a UNION in the checker (`true | false`), so a plain
// boolean-typed property could not select the union arm it names.
//
// Same rule as 3501, second population. `literalUnionArmOf`'s field test
// compared the property's whole checker type against the arm's field
// type. A property written as a boolean LITERAL (`retryType: true`) fitted
// `boolean | undefined` through the literal branch; the SAME property
// written as an expression (`includeParticipant: t !== 'x'`) has checker
// type `boolean`, which tsc models as the union `true | false`, and no
// branch of the test admitted a union source — so the arm probe declined,
// the literal fell back to its own inferred type, and the call fenced with
// SC2003 naming the whole five-arm union.
//
// zapo hits it twice, at `client/events/incoming.ts:154` and `:162`, in the
// ack builder for every inbound receipt and notification — one line after
// a `retryType: true` call that always compiled.
//
// Decomposing the source union arm-wise answers it: `true` fits and
// `false` fits, so `boolean` fits. The rule is `every`, so a source union
// with an arm that has no home still declines, and an ambiguous literal
// (two fitting arms) still declines — both pinned below by construction.

interface Node2 {
    readonly tag: string;
    readonly attrs: Readonly<Record<string, string>>;
}

type AckInput =
    | {
          readonly kind: "notification";
          readonly node: Node2;
          readonly typeOverride?: string;
          readonly includeParticipant?: boolean;
          readonly includeType?: boolean;
      }
    | {
          readonly kind: "message";
          readonly node: Node2;
          readonly id: string;
          readonly to: string;
          readonly error?: number | string;
      }
    | {
          readonly kind: "receipt";
          readonly node: Node2;
          readonly retryType?: boolean;
          readonly includeParticipant?: boolean;
          readonly includeRecipient?: boolean;
      };

function build(i: AckInput): string {
    if (i.kind === "receipt") {
        return `receipt tag=${i.node.tag} retry=${String(i.retryType ?? false)} ip=${String(i.includeParticipant ?? false)} ir=${String(i.includeRecipient ?? false)}`;
    }
    if (i.kind === "message") {
        return `message tag=${i.node.tag} id=${i.id} to=${i.to} err=${i.error === undefined ? "-" : String(i.error)}`;
    }
    return `notification tag=${i.node.tag} ip=${String(i.includeParticipant ?? false)} it=${String(i.includeType ?? false)} ov=${i.typeOverride ?? "-"}`;
}

const node: Node2 = { tag: "receipt", attrs: { id: "x1", type: "read", from: "a@s" } };
const receiptType = node.attrs.type;

// The spelling that always compiled: a boolean LITERAL.
console.log(build({ kind: "receipt", node, retryType: true }));
console.log(build({ kind: "receipt", node, retryType: false }));

// The spelling that fenced: a boolean EXPRESSION. Same field, same arm.
console.log(build({ kind: "receipt", node, includeParticipant: receiptType !== "server-error" }));
console.log(build({ kind: "receipt", node, includeParticipant: receiptType === "server-error" }));

// zapo's `:162`, two boolean expressions at once, into a different arm.
const ntype = node.attrs.type ?? "";
console.log(
    build({
        kind: "notification",
        node,
        includeParticipant: ntype === "w:gp2" || ntype === "read",
        includeType: ntype !== "read",
    }),
);

// A boolean held in a BINDING, and one produced by a call.
const flag = receiptType.length > 2;
function computed(): boolean {
    return receiptType.startsWith("r");
}
console.log(build({ kind: "receipt", node, includeParticipant: flag, includeRecipient: computed() }));

// The arms that never needed the rule still resolve to themselves.
console.log(build({ kind: "message", node, id: "m1", to: "a@s" }));
console.log(build({ kind: "message", node, id: "m2", to: "b@s", error: 401 }));
console.log(build({ kind: "message", node, id: "m3", to: "c@s", error: "gone" }));

// A NON-boolean union property, decomposed the same way: `number | string`
// into a field declared `number | string | undefined`.
const codes: readonly (number | string)[] = [404, "timeout"];
for (const c of codes) {
    console.log(build({ kind: "message", node, id: "m4", to: "d@s", error: c }));
}

// EVERY arm must fit, so a source union stays out of a field that admits
// only part of it: `error` is declared `number | string`, and a `boolean`
// has no home there. Spelled through the arm that does admit it instead —
// this is the shape the `every` rule keeps refusing, written the way the
// author has to write it.
const maybe: number | string | boolean = flag ? true : 500;
console.log(build({ kind: "message", node, id: "m5", to: "e@s", error: typeof maybe === "boolean" ? String(maybe) : maybe }));

// Own-key order and PRESENCE of a literal built AS the selected arm. The
// arm carries optional fields this literal never writes; building at the
// arm must not invent them. (A record shape is interned per field-name
// set with the order it was first seen in, so a literal that writes the
// arm's names in any order shares one shape with it — the selection can
// only ever add UNWRITTEN optional fields, and those must stay absent.)
interface ReceiptArm {
    readonly kind: "receipt";
    readonly node: Node2;
    readonly retryType?: boolean;
    readonly includeParticipant?: boolean;
    readonly includeRecipient?: boolean;
}
function inspect(r: ReceiptArm): string {
    return [
        Object.keys(r).join(","),
        `retryType-in=${String("retryType" in r)}`,
        `includeRecipient-in=${String("includeRecipient" in r)}`,
        JSON.stringify({ kind: r.kind, retryType: r.retryType, includeParticipant: r.includeParticipant }),
    ].join(" ");
}
function pick(ip: boolean): AckInput {
    return { kind: "receipt", node, includeParticipant: ip };
}
const picked = pick(receiptType !== "server-error");
if (picked.kind === "receipt") console.log("arm", inspect(picked));

console.log("done");
