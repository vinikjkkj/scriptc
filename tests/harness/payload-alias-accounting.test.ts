/* The static/dyn boundary is a COPY in both directions, and only one of the
 * two directions is loud.
 *
 * scriptc keeps a composite in two physically different shapes: a monomorphic
 * C struct (record) or a packed `ScrArr`, and a `ScrDyn` key-value table.
 * Converting between them cannot alias, so it copies. The project already
 * knows the static->dyn half: `dynCopyIsObservable` marks the copy with
 * `scr_dyn_mark_static_copy`, and a write THROUGH the marked dyn refuses
 * loudly (`scr_dyn_static_copy_refuse`) instead of being dropped.
 *
 * The dyn->static half has no such fence. `sc_dc_N` builds a FRESH struct
 * with `sc_rnew_rN`; nothing marks it; a store into it lands on the copy and
 * is lost in silence. That is not a hypothesis — it is how `contextInfo`
 * disappears from a quoted reply on zapo's wire, three witnesses deep (the
 * decrypted peer message, the client's own send dump, and the outbound
 * stanza's ciphertext length, 211 bytes against 146), while `stanza.count`
 * reads 76, the tag multiset matches and the process exits 0.
 *
 * The program below is a transcription of zapo's own
 * `src/message/context-info.ts` — `applyContextInfo`, `pickContextInfoTarget`
 * and `hasAnyKey` — derived from the ORACLE repo, not from anything scriptc
 * emits. Node prints the `contextInfo`; both compiled backends print the
 * message without it.
 *
 * WHAT THIS FILE PINS, and why it is an accounting file rather than a
 * differential one. The divergence is NOT fixed: closing it needs a
 * dyn-backed record representation (a store into a record recovered from a
 * dyn would have to reach the dyn it came from, ACROSS A SHAPE CHANGE —
 * `ContextInfoCarrier` is not `IExtendedTextMessage`), which is a
 * representation change, not a lowering one. Refusing the store instead
 * would trade a silent wrong value for a process abort on every quoted send,
 * and zapo would stop pairing. So what is pinned here is the SHAPE and the
 * COUNT:
 *
 *   * the emitted C really does route the store into a record recovered from
 *     a MARKED static copy — if a future change makes the boundary alias, or
 *     makes it refuse, this assertion is what says so;
 *   * `scripts/dyn-recover-census.mjs`, run over that same emitted C, finds
 *     exactly ONE silent lost write and names it. The number may only go
 *     DOWN. A rise means a new site of the same family.
 *
 * Both instruments carry their own planted-fact self-tests, and those are
 * asserted here too: an instrument that cannot report "nothing changed"
 * cannot be trusted when it does. The census self-test caught itself twice —
 * once reporting a false ZERO on a 121 MB TU whose sites `rg` counts
 * directly (its function splitter did not survive a trailing source comment),
 * and once classifying zapo's own recovery as "other" because the checker is
 * declared `check union:u874` and only its ARM is `record:r1385`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");

/** zapo's `src/message/context-info.ts`, reduced to the three functions the
 * quoted reply walks through, with the protobuf shapes cut down to the
 * fields the fixture's script actually fills. Every line is the oracle's. */
const PROGRAM = `interface IContextInfo {
    stanzaId?: string
    participant?: string
}
interface IExtendedTextMessage {
    text?: string
    contextInfo?: IContextInfo | null
}
interface IMessage {
    conversation?: string
    extendedTextMessage?: IExtendedTextMessage
}
interface ContextInfoCarrier {
    contextInfo?: IContextInfo | null
}
interface WaSendContextInfo {
    quotedMessageId?: string
    quotedParticipant?: string
}
function hasAnyKey(value: object): boolean {
    for (const _ in value) {
        return true
    }
    return false
}
function buildContextInfoProto(input: WaSendContextInfo): IContextInfo {
    const ctx: IContextInfo = {}
    if (input.quotedMessageId !== undefined) ctx.stanzaId = input.quotedMessageId
    if (input.quotedParticipant !== undefined) ctx.participant = input.quotedParticipant
    return ctx
}
function pickContextInfoTarget(message: IMessage): ContextInfoCarrier | null {
    for (const key of Object.keys(message)) {
        const value = (message as unknown as Record<string, unknown>)[key]
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value as ContextInfoCarrier
        }
    }
    return null
}
function applyContextInfo(message: IMessage, ctx: WaSendContextInfo | null): IMessage {
    if (!ctx) return message
    const proto = buildContextInfoProto(ctx)
    if (!hasAnyKey(proto)) return message
    const next: IMessage = { ...message }
    if (typeof next.conversation === 'string' && !next.extendedTextMessage) {
        next.extendedTextMessage = { text: next.conversation }
        delete next.conversation
    }
    const target = pickContextInfoTarget(next)
    if (!target) throw new Error('cannot apply contextInfo: no compatible submessage found')
    target.contextInfo = { ...target.contextInfo, ...proto }
    return next
}
const out = applyContextInfo(
    { conversation: 'quoted-reply' },
    { quotedMessageId: 'ID20', quotedParticipant: 'peer@s.whatsapp.net' }
)
console.log(JSON.stringify(out))
`;

async function emitC(): Promise<string> {
  const outDir = join(cacheDir, "payload-alias-accounting");
  mkdirSync(outDir, { recursive: true });
  const src = join(outDir, "payload-alias-input.ts");
  writeFileSync(src, PROGRAM, "utf8");
  // Pinned: this file measures the C backend's artifact. The LLVM lane
  // produces the same OUTPUT divergence (measured, both backends print the
  // message without its contextInfo), but the C text is what is greppable.
  const result = await compile(src, { outPath: join(outDir, "program"), outDir, backend: "c" });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; "));
  }
  return readFileSync(result.cPath, "utf8");
}

describe("the dyn->static recovery is a copy, and the store into it is lost", () => {

  test("the source is really the zapo shape: a MARKED static copy feeds a keyed read", async () => {
    const c = await emitC();
    // The record is copied wholesale into a dyn, and the compiler already
    // judges the copy observable. That mark is now spelled
    // `scr_dyn_origin_mark`, which performs `scr_dyn_mark_static_copy`'s
    // whole effect and additionally records the object the copy was made
    // FROM — so the marking this row is about is unchanged, and only its
    // call site's name moved.
    expect(c).toMatch(/scr_dyn_origin_mark\(sc_td_\d+\(/);
    expect(c).toMatch(/sc_dyn_key_get\(/);
  });

  test("the recovered carrier is a FRESH struct here, because the SHAPE changes", async () => {
    const c = await emitC();
    // Every record checker still allocates, and on THIS program the
    // allocation is still what runs.
    //
    // A checker now opens with an origin recovery: when the dyn is a
    // boundary copy of a live static object OF THE SAME TYPE, it hands that
    // object back and never reaches the allocation. That is what closes the
    // round-trip half of this family — but not this program. The whole point
    // of the zapo shape is that the recovery crosses A SHAPE CHANGE:
    // `ContextInfoCarrier` is not `IExtendedTextMessage`, so the interned
    // type key the copy carries is not the key this checker asks for, the
    // origin lookup misses, and the fresh struct below is what the store
    // lands on. The divergence this file pins is therefore intact, and the
    // assertion is deliberately kept as "it allocates" rather than relaxed.
    const checkers = [...c.matchAll(/static sc_rs_r\d+ \*(sc_dc_\d+)\(const ScrDyn \*d[^)]*\) \{/g)];
    expect(checkers.length).toBeGreaterThan(0);
    for (const m of checkers) {
      const body = c.slice(m.index!, c.indexOf("\n}\n", m.index!));
      expect(body).toMatch(/sc_rnew_r\d+\(\)/);
    }
  });

  test("the store really lands on the recovered value", async () => {
    const c = await emitC();
    expect(c).toMatch(/->sc_fld_contextInfo = /);
  });

  test("the census finds exactly ONE silent lost write, and names it", async () => {
    const c = await emitC();
    const dir = mkdtempSync(join(tmpdir(), "payload-alias-c-"));
    const cPath = join(dir, "ctx.c");
    writeFileSync(cPath, c, "utf8");
    const out = execFileSync(
      process.execPath,
      [join(repoRoot, "scripts/dyn-recover-census.mjs"), cPath],
      { encoding: "utf8" },
    );
    // The denominator first: a census that examined nothing is not evidence.
    const recov = /recovery CALL SITES in program code: (\d+)/.exec(out);
    expect(recov).not.toBeNull();
    expect(Number(recov![1])).toBeGreaterThan(0);
    // Then the number this file exists to pin. It may only go DOWN.
    expect(out).toMatch(/==> SILENT LOST WRITES: 1 {3}\(0 local, 1 across one call boundary\)/);
    expect(out).toMatch(/applyContextInfo <- .*pickContextInfoTarget/);
  });
});

describe("both instruments recover every fact they plant", () => {
  test("scripts/dyn-recover-census.mjs --selftest", () => {
    const out = execFileSync(
      process.execPath,
      [join(repoRoot, "scripts/dyn-recover-census.mjs"), "--selftest"],
      { encoding: "utf8" },
    );
    expect(out).toMatch(/21 planted facts, 21 recovered, 0 lost/);
    expect(out).not.toMatch(/^ {2}FAIL/m);
  });

  test("scripts/payload-field-cmp.mjs --selftest", () => {
    const out = execFileSync(
      process.execPath,
      [join(repoRoot, "scripts/payload-field-cmp.mjs"), "--selftest"],
      { encoding: "utf8" },
    );
    expect(out).toMatch(/18 planted facts, 18 recovered, 0 lost/);
    expect(out).not.toMatch(/^ {2}FAIL/m);
  });
});
