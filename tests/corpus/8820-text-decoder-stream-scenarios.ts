function cps(s: string): string {
  let r = "";
  for (let i = 0; i < s.length; i++) r += s.charCodeAt(i).toString(16) + " ";
  return r;
}
function show(f: () => string): string {
  try {
    return "OK:" + cps(f());
  } catch {
    return "ERR";
  }
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-split-euro", 0, show(() => d.decode(new Uint8Array([0xe2, 0x82]), { stream: true })));
  console.log("u8-split-euro", 1, show(() => d.decode(new Uint8Array([0xac]), { stream: true })));
  console.log("u8-split-euro", 2, show(() => d.decode(new Uint8Array([0x41]))));
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-flush-pending-noargs", 0, show(() => d.decode(new Uint8Array([0xe2]), { stream: true })));
  console.log("u8-flush-pending-noargs", 1, show(() => d.decode()));
  console.log("u8-flush-pending-noargs", 2, show(() => d.decode(new Uint8Array([0x41]))));
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-invalid-after-pending", 0, show(() => d.decode(new Uint8Array([0xe2]), { stream: true })));
  console.log("u8-invalid-after-pending", 1, show(() => d.decode(new Uint8Array([0x41]), { stream: true })));
  console.log("u8-invalid-after-pending", 2, show(() => d.decode(new Uint8Array([0x42]))));
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-pending-then-flush-u", 0, show(() => d.decode(new Uint8Array([0xe2]), { stream: true })));
  console.log("u8-pending-then-flush-u", 1, show(() => d.decode(undefined)));
  console.log("u8-pending-then-flush-u", 2, show(() => d.decode(new Uint8Array([0x41]))));
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-pending-then-pair", 0, show(() => d.decode(new Uint8Array([0xe2]), { stream: true })));
  console.log("u8-pending-then-pair", 1, show(() => d.decode(new Uint8Array([0x82, 0xac]))));
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-null-options-streams", 0, show(() => d.decode(new Uint8Array([0xe2]), null as any)));
  console.log("u8-null-options-streams", 1, show(() => d.decode(new Uint8Array([0x82, 0xac]))));
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-invalid-middle", 0, show(() => d.decode(new Uint8Array([0xe2, 0x41]), { stream: true })));
  console.log("u8-invalid-middle", 1, show(() => d.decode(new Uint8Array([0x42]))));
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-bom-split", 0, show(() => d.decode(new Uint8Array([0xef]), { stream: true })));
  console.log("u8-bom-split", 1, show(() => d.decode(new Uint8Array([0xbb, 0xbf, 0x41]))));
}
{
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log("u8-bom-split-ignore", 0, show(() => d.decode(new Uint8Array([0xef]), { stream: true })));
  console.log("u8-bom-split-ignore", 1, show(() => d.decode(new Uint8Array([0xbb, 0xbf, 0x41]))));
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-bom-after-flush", 0, show(() => d.decode(new Uint8Array([0x41]))));
  console.log("u8-bom-after-flush", 1, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x42]))));
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-bom-after-stream-only", 0, show(() => d.decode(new Uint8Array([0x41]), { stream: true })));
  console.log("u8-bom-after-stream-only", 1, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x42]))));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log("u8-fatal-pending-ok", 0, show(() => d.decode(new Uint8Array([0xe2]), { stream: true })));
  console.log("u8-fatal-pending-ok", 1, show(() => d.decode(new Uint8Array([0x82, 0xac]))));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log("u8-fatal-error-mid-stream", 0, show(() => d.decode(new Uint8Array([0x41, 0xe2]), { stream: true })));
  console.log("u8-fatal-error-mid-stream", 1, show(() => d.decode(new Uint8Array([0x41]))));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log("u8-fatal-error-then-again", 0, show(() => d.decode(new Uint8Array([0xe2]), { stream: true })));
  console.log("u8-fatal-error-then-again", 1, show(() => d.decode(new Uint8Array([0x41]))));
  console.log("u8-fatal-error-then-again", 2, show(() => d.decode(new Uint8Array([0x41]))));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log("u8-fatal-flush-error", 0, show(() => d.decode(new Uint8Array([0xe2]), { stream: true })));
  console.log("u8-fatal-flush-error", 1, show(() => d.decode()));
  console.log("u8-fatal-flush-error", 2, show(() => d.decode(new Uint8Array([0x41]))));
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-truncated-lead-at-end", 0, show(() => d.decode(new Uint8Array([0xf0, 0x9f]), { stream: true })));
  console.log("u8-truncated-lead-at-end", 1, show(() => d.decode(new Uint8Array([0x98, 0x80]))));
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-stream-bad-continuation", 0, show(() => d.decode(new Uint8Array([0xf0, 0x9f]), { stream: true })));
  console.log("u8-stream-bad-continuation", 1, show(() => d.decode(new Uint8Array([0x41, 0x42]), { stream: true })));
  console.log("u8-stream-bad-continuation", 2, show(() => d.decode()));
}
{
  const d = new TextDecoder("utf-16le");
  console.log("u16-odd-then-rest", 0, show(() => d.decode(new Uint8Array([0x41]), { stream: true })));
  console.log("u16-odd-then-rest", 1, show(() => d.decode(new Uint8Array([0x0, 0x42, 0x0]), { stream: true })));
  console.log("u16-odd-then-rest", 2, show(() => d.decode()));
}
{
  const d = new TextDecoder("utf-16le");
  console.log("u16-surrogate-split", 0, show(() => d.decode(new Uint8Array([0x3d]), { stream: true })));
  console.log("u16-surrogate-split", 1, show(() => d.decode(new Uint8Array([0xd8, 0x0]), { stream: true })));
  console.log("u16-surrogate-split", 2, show(() => d.decode(new Uint8Array([0xde]))));
}
{
  const d = new TextDecoder("utf-16le");
  console.log("u16-lead-then-nontrail", 0, show(() => d.decode(new Uint8Array([0x0, 0xd8]), { stream: true })));
  console.log("u16-lead-then-nontrail", 1, show(() => d.decode(new Uint8Array([0x41, 0x0]))));
}
{
  const d = new TextDecoder("utf-16le");
  console.log("u16-lead-pending-flush", 0, show(() => d.decode(new Uint8Array([0x0, 0xd8]), { stream: true })));
  console.log("u16-lead-pending-flush", 1, show(() => d.decode()));
}
{
  const d = new TextDecoder("utf-16le");
  console.log("u16-bom-split", 0, show(() => d.decode(new Uint8Array([0xff]), { stream: true })));
  console.log("u16-bom-split", 1, show(() => d.decode(new Uint8Array([0xfe, 0x41, 0x0]))));
}
{
  const d = new TextDecoder("utf-16be");
  console.log("u16be-bom-split", 0, show(() => d.decode(new Uint8Array([0xfe]), { stream: true })));
  console.log("u16be-bom-split", 1, show(() => d.decode(new Uint8Array([0xff, 0x0, 0x41]))));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log("u16-fatal-odd-flush", 0, show(() => d.decode(new Uint8Array([0x41]), { stream: true })));
  console.log("u16-fatal-odd-flush", 1, show(() => d.decode()));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log("u16-fatal-lead-then-nontrail", 0, show(() => d.decode(new Uint8Array([0x0, 0xd8]), { stream: true })));
  console.log("u16-fatal-lead-then-nontrail", 1, show(() => d.decode(new Uint8Array([0x41, 0x0]))));
}
{
  const d = new TextDecoder("utf-16le");
  console.log("u16-bom-after-flush", 0, show(() => d.decode(new Uint8Array([0x41, 0x0]))));
  console.log("u16-bom-after-flush", 1, show(() => d.decode(new Uint8Array([0xff, 0xfe, 0x42, 0x0]))));
}
{
  const d = new TextDecoder("windows-1252");
  console.log("sb-stream-plain", 0, show(() => d.decode(new Uint8Array([0xe9]), { stream: true })));
  console.log("sb-stream-plain", 1, show(() => d.decode(new Uint8Array([0x80]), { stream: true })));
  console.log("sb-stream-plain", 2, show(() => d.decode()));
}
{
  const d = new TextDecoder("koi8-r", { fatal: true });
  console.log("sb-fatal-stream", 0, show(() => d.decode(new Uint8Array([0xc1]), { stream: true })));
  console.log("sb-fatal-stream", 1, show(() => d.decode(new Uint8Array([0x80]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-nonstream-after-stream-no-flush", 0, show(() => d.decode(new Uint8Array([0xe2]), { stream: true })));
  console.log("u8-nonstream-after-stream-no-flush", 1, show(() => d.decode(new Uint8Array([0x41]))));
  console.log("u8-nonstream-after-stream-no-flush", 2, show(() => d.decode(new Uint8Array([0x41]))));
}
{
  const d = new TextDecoder("utf-8");
  console.log("u8-stream-false-explicit", 0, show(() => d.decode(new Uint8Array([0xe2]), { stream: false })));
  console.log("u8-stream-false-explicit", 1, show(() => d.decode(new Uint8Array([0x41]))));
}
