// `Promise.allSettled` over entries with DIFFERENT payloads -- the shape
// zapo's media-send path writes:
//
//   const [uploadResult, processResult] = await Promise.allSettled([
//     uploadPromise, processPromise
//   ])
//   if (uploadResult.status === 'rejected') throw uploadResult.reason
//
// The checker's tuple overload types the result as
// `[PromiseSettledResult<Uploaded>, PromiseSettledResult<Processed>]`, so the
// two positions carry DIFFERENT settled descriptions and the uniform reader
// -- "is every position the same R" -- answers no.
//
// Each entry wraps through its OWN settled adapter, exactly as the uniform
// form does, and the wrapped promises (which cannot reject) go to the
// heterogeneous tuple combinator Promise.all has had all along. Wrapping
// happens BEFORE any await, so an entry rejecting while another is still in
// flight is observed rather than left unhandled until its turn -- which is
// what makes allSettled different from awaiting the entries in sequence.

type Uploaded = { readonly url: string; readonly len: number };
type Processed = { readonly w: number; readonly h: number };

function nap(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}
async function upload(ms: number, url: string): Promise<Uploaded> {
  await nap(ms);
  return { url, len: url.length };
}
async function process_(ms: number, w: number): Promise<Processed> {
  await nap(ms);
  return { w, h: w / 2 };
}
async function failUpload(ms: number, why: string): Promise<Uploaded> {
  await nap(ms);
  throw new Error(why);
}
async function failProcess(ms: number, why: string): Promise<Processed> {
  await nap(ms);
  throw new Error(why);
}

const order: string[] = [];
async function markUp(tag: string, v: Uploaded): Promise<Uploaded> {
  order.push(tag);
  await nap(2);
  return v;
}
async function markPr(tag: string, v: Processed): Promise<Processed> {
  order.push(tag);
  await nap(2);
  return v;
}
async function markSt(tag: string, v: string): Promise<string> {
  order.push(tag);
  await nap(2);
  return v;
}

function reasonText(r: unknown): string {
  return r instanceof Error ? r.message : "non-error";
}

async function main(): Promise<void> {
  // (1) Both fulfil. The slower entry is FIRST, so a positional sequence
  // would settle them in the other order; the tuple is still in literal
  // order.
  const [u1, p1] = await Promise.allSettled([upload(9, "mmg://a"), process_(3, 640)]);
  console.log("1:", u1.status, p1.status);
  if (u1.status === "fulfilled") console.log("  u:", u1.value.url, u1.value.len);
  if (p1.status === "fulfilled") console.log("  p:", p1.value.w, p1.value.h);

  // (2) The FIRST position rejects while the second is still pending. Its
  // reason is carried, and the second position still fulfils -- neither
  // rejection escapes the combinator.
  const [u2, p2] = await Promise.allSettled([failUpload(2, "upload-failed"), process_(9, 320)]);
  console.log("2:", u2.status, p2.status);
  if (u2.status === "rejected") console.log("  reason:", reasonText(u2.reason));
  if (p2.status === "fulfilled") console.log("  p:", p2.value.w, p2.value.h);

  // (3) The SECOND position rejects, the first fulfils.
  const [u3, p3] = await Promise.allSettled([upload(2, "mmg://b"), failProcess(9, "process-failed")]);
  console.log("3:", u3.status, p3.status);
  if (u3.status === "fulfilled") console.log("  u:", u3.value.url);
  if (p3.status === "rejected") console.log("  reason:", reasonText(p3.reason));

  // (4) BOTH reject, the later position first in TIME. Both reasons survive.
  const [u4, p4] = await Promise.allSettled([failUpload(9, "one"), failProcess(2, "two")]);
  console.log("4:", u4.status, p4.status);
  if (u4.status === "rejected" && p4.status === "rejected") {
    console.log("  reasons:", reasonText(u4.reason), reasonText(p4.reason));
  }

  // (5) THREE positions, three different payload types -- including two
  // scalars, whose settled descriptions differ from each other and from the
  // record's.
  const [a5, b5, c5] = await Promise.allSettled([
    upload(4, "mmg://c"),
    (async (): Promise<string> => {
      await nap(2);
      return "text";
    })(),
    (async (): Promise<number> => {
      await nap(6);
      return 17;
    })(),
  ]);
  console.log("5:", a5.status, b5.status, c5.status);
  if (a5.status === "fulfilled") console.log("  a:", a5.value.url);
  if (b5.status === "fulfilled") console.log("  b:", b5.value, typeof b5.value);
  if (c5.status === "fulfilled") console.log("  c:", c5.value, typeof c5.value);

  // (6) A HOLE in the destructuring pattern: the first position is settled
  // and dropped, and its work still happens.
  let ran = 0;
  const bump = async (): Promise<Uploaded> => {
    await nap(2);
    ran = ran + 1;
    return { url: "mmg://d", len: 1 };
  };
  const [, only] = await Promise.allSettled([bump(), process_(4, 100)]);
  console.log("6:", ran, only.status);
  if (only.status === "fulfilled") console.log("  only:", only.value.w);

  // (7) NOT destructured: the tuple held as a value, read by index, and
  // passed on at its own type.
  const held = await Promise.allSettled([upload(3, "mmg://e"), process_(5, 200)]);
  console.log("7:", held.length, held[0].status, held[1].status);
  const first: PromiseSettledResult<Uploaded> = held[0];
  const second: PromiseSettledResult<Processed> = held[1];
  console.log("  ", first.status === "fulfilled" ? first.value.len : "-", second.status === "fulfilled" ? second.value.h : "-");

  // (8) Every entry is evaluated exactly ONCE, left to right.
  const [m1, m2, m3] = await Promise.allSettled([
    markUp("u", { url: "mmg://f", len: 6 }),
    markPr("p", { w: 10, h: 5 }),
    markSt("s", "z"),
  ]);
  console.log("8:", order.join(">"), m1.status, m2.status, m3.status);

  // (9) The same call shape reached twice interns ONE tuple helper; the
  // second use must not read the first one's positions.
  const [u9, p9] = await Promise.allSettled([upload(2, "mmg://g"), process_(3, 800)]);
  if (u9.status === "fulfilled" && p9.status === "fulfilled") {
    console.log("9:", u9.value.url, u9.value.len, p9.value.w, p9.value.h);
  }
}

void main();
