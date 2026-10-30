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
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log(0, 0, show(() => d.decode(new Uint8Array([]), null as any)));
  console.log(0, 1, show(() => d.decode(new Uint8Array([0x41, 0x90, 0xe1, 0x82]), { stream: true })));
  console.log(0, 2, show(() => d.decode(new Uint8Array([0xfe, 0x90, 0xdf]), undefined)));
  console.log(0, 3, show(() => d.decode(new Uint8Array([0xef, 0xfe]), { stream: true })));
}
{
  const d = new TextDecoder("koi8-r", { fatal: true });
  console.log(1, 0, show(() => d.decode(new Uint8Array([0xde]), undefined)));
  console.log(1, 1, show(() => d.decode(new Uint8Array([0xe1, 0x82, 0xff, 0xa0]), undefined)));
}
{
  const d = new TextDecoder("utf-8");
  console.log(2, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(2, 1, show(() => d.decode()));
  console.log(2, 2, show(() => d.decode(new Uint8Array([0xd8, 0xfe, 0xc2]), { stream: true })));
  console.log(2, 3, show(() => d.decode(new Uint8Array([0xc0, 0x3d, 0x9f, 0xf4]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(3, 0, show(() => d.decode(new Uint8Array([0xe0]), { stream: true })));
  console.log(3, 1, show(() => d.decode(new Uint8Array([0x41, 0xbf, 0xac, 0xbf]), { stream: false })));
}
{
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log(4, 0, show(() => d.decode(undefined, { stream: true })));
  console.log(4, 1, show(() => d.decode(new Uint8Array([0xff, 0xfe, 0x7f, 0x82]), { stream: true })));
  console.log(4, 2, show(() => d.decode(new Uint8Array([0xbb, 0xbb]), { stream: true })));
  console.log(4, 3, show(() => d.decode(new Uint8Array([0x90, 0xff, 0xd8]), null as any)));
}
{
  const d = new TextDecoder("koi8-r", { fatal: true });
  console.log(5, 0, show(() => d.decode(new Uint8Array([0xac]), { stream: true })));
  console.log(5, 1, show(() => d.decode(new Uint8Array([0x80, 0xbf]))));
  console.log(5, 2, show(() => d.decode(new Uint8Array([0xc2, 0xa0]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log(6, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(7, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(7, 1, show(() => d.decode(undefined, { stream: true })));
  console.log(7, 2, show(() => d.decode(new Uint8Array([0xf0, 0xbf, 0xdb]), { stream: false })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(8, 0, show(() => d.decode(new Uint8Array([0x80]), null as any)));
  console.log(8, 1, show(() => d.decode(new Uint8Array([0xf4, 0x7f, 0x90, 0x90]), undefined)));
  console.log(8, 2, show(() => d.decode(new Uint8Array([0xf0, 0x80, 0x98, 0xa0]), { stream: false })));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(9, 0, show(() => d.decode(new Uint8Array([0xdf, 0x90, 0x7f]))));
  console.log(9, 1, show(() => d.decode(new Uint8Array([0x80, 0x80]), { stream: false })));
  console.log(9, 2, show(() => d.decode(new Uint8Array([0xc2]), { stream: true })));
  console.log(9, 3, show(() => d.decode(new Uint8Array([0xe1, 0xbf, 0x9f]), { stream: true })));
}
{
  const d = new TextDecoder("koi8-r", { fatal: true });
  console.log(10, 0, show(() => d.decode(new Uint8Array([0x0]), { stream: true })));
  console.log(10, 1, show(() => d.decode(new Uint8Array([0x8f, 0xfe, 0xe0, 0x9f]), { stream: true })));
  console.log(10, 2, show(() => d.decode(undefined, { stream: true })));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(11, 0, show(() => d.decode(new Uint8Array([0xe9, 0xc2, 0x80]), { stream: true })));
  console.log(11, 1, show(() => d.decode(new Uint8Array([0xa0, 0xf4]), { stream: true })));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(12, 0, show(() => d.decode(new Uint8Array([0xbb]), { stream: false })));
  console.log(12, 1, show(() => d.decode(new Uint8Array([0x80, 0x0, 0xdf]), { stream: true })));
  console.log(12, 2, show(() => d.decode(new Uint8Array([0x8f]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(13, 0, show(() => d.decode(new Uint8Array([0xde]), { stream: true })));
  console.log(13, 1, show(() => d.decode(new Uint8Array([0x9f]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(14, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(14, 1, show(() => d.decode(new Uint8Array([0xfe, 0x9f, 0xef]), undefined)));
}
{
  const d = new TextDecoder("utf-8");
  console.log(15, 0, show(() => d.decode(new Uint8Array([0xff, 0xdf, 0xe0, 0xe9]), { stream: true })));
  console.log(15, 1, show(() => d.decode(new Uint8Array([0xbb, 0x9f, 0xd8, 0x80]), { stream: true })));
  console.log(15, 2, show(() => d.decode(new Uint8Array([]))));
  console.log(15, 3, show(() => d.decode(new Uint8Array([0xbf, 0xbb, 0xdf, 0xed]))));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(16, 0, show(() => d.decode(new Uint8Array([0xa0, 0xbf, 0xd8, 0x9f]), { stream: true })));
  console.log(16, 1, show(() => d.decode(new Uint8Array([0x3d, 0xd8, 0xbf]), { stream: true })));
  console.log(16, 2, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(16, 3, show(() => d.decode(new Uint8Array([0x7f, 0xdb, 0x7f, 0xe9]))));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(17, 0, show(() => d.decode(new Uint8Array([0x41]), { stream: true })));
  console.log(17, 1, show(() => d.decode(new Uint8Array([0x9f, 0x8f, 0x0]), { stream: false })));
  console.log(17, 2, show(() => d.decode(new Uint8Array([0xfe, 0xe0, 0xbf]), { stream: false })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(18, 0, show(() => d.decode(new Uint8Array([0xa0, 0xfe]), undefined)));
  console.log(18, 1, show(() => d.decode(new Uint8Array([0x98, 0xe1, 0x90]), { stream: false })));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(19, 0, show(() => d.decode(new Uint8Array([0xff, 0xe9, 0x90]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(20, 0, show(() => d.decode(new Uint8Array([0xef, 0xdc, 0x8f]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(21, 0, show(() => d.decode(new Uint8Array([0xac, 0xbb, 0xed, 0xbf]), { stream: true })));
  console.log(21, 1, show(() => d.decode(new Uint8Array([0x41, 0xbb, 0x9f, 0x9f]), { stream: true })));
  console.log(21, 2, show(() => d.decode(new Uint8Array([0xbb, 0xf0, 0xdb, 0x41]), { stream: false })));
  console.log(21, 3, show(() => d.decode(new Uint8Array([0xbf]), { stream: true })));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(22, 0, show(() => d.decode(new Uint8Array([0xc2, 0xdf]), { stream: false })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(23, 0, show(() => d.decode(new Uint8Array([]), null as any)));
}
{
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log(24, 0, show(() => d.decode(undefined, { stream: false })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(25, 0, show(() => d.decode(new Uint8Array([0xef, 0xff, 0xbb, 0xdf]))));
  console.log(25, 1, show(() => d.decode(new Uint8Array([0xf5, 0xe9]), { stream: false })));
  console.log(25, 2, show(() => d.decode(undefined, { stream: true })));
  console.log(25, 3, show(() => d.decode(new Uint8Array([0xbf, 0xbf, 0xf0]), null as any)));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(26, 0, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(26, 1, show(() => d.decode(new Uint8Array([0x9f]), { stream: false })));
  console.log(26, 2, show(() => d.decode(new Uint8Array([]))));
  console.log(26, 3, show(() => d.decode(new Uint8Array([0xc0]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(27, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(27, 1, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(27, 2, show(() => d.decode()));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(28, 0, show(() => d.decode(undefined, { stream: false })));
  console.log(28, 1, show(() => d.decode(new Uint8Array([0xdf, 0xff, 0x0]), { stream: true })));
  console.log(28, 2, show(() => d.decode(new Uint8Array([0xfe, 0x80]), { stream: true })));
  console.log(28, 3, show(() => d.decode(new Uint8Array([0xbf, 0x82, 0xbf, 0x98]), undefined)));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(29, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(29, 1, show(() => d.decode(new Uint8Array([0xc2, 0xbf]), { stream: true })));
  console.log(29, 2, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(29, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(30, 0, show(() => d.decode(new Uint8Array([0x80, 0xe0, 0xc2, 0xfe]), { stream: true })));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(31, 0, show(() => d.decode(new Uint8Array([0x7f]), { stream: true })));
  console.log(31, 1, show(() => d.decode(new Uint8Array([0xc0]), undefined)));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(32, 0, show(() => d.decode(undefined, { stream: true })));
  console.log(32, 1, show(() => d.decode(new Uint8Array([0xff, 0xa0]), { stream: true })));
  console.log(32, 2, show(() => d.decode(new Uint8Array([0x8f, 0xc2]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(33, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(33, 1, show(() => d.decode(new Uint8Array([0x8f, 0xdf, 0x8f, 0xdf]), { stream: false })));
  console.log(33, 2, show(() => d.decode(new Uint8Array([0xa0, 0xfe]), { stream: true })));
  console.log(33, 3, show(() => d.decode(new Uint8Array([0xfe, 0xd8, 0xe0]))));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(34, 0, show(() => d.decode(new Uint8Array([0xef]))));
  console.log(34, 1, show(() => d.decode(new Uint8Array([0x41]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(35, 0, show(() => d.decode(new Uint8Array([0xac, 0xbb, 0xed, 0xde]), { stream: false })));
  console.log(35, 1, show(() => d.decode(new Uint8Array([0xf4]), { stream: true })));
  console.log(35, 2, show(() => d.decode(new Uint8Array([]))));
  console.log(35, 3, show(() => d.decode()));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(36, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("koi8-r", { fatal: true });
  console.log(37, 0, show(() => d.decode(undefined, { stream: false })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(38, 0, show(() => d.decode(new Uint8Array([]), null as any)));
  console.log(38, 1, show(() => d.decode(new Uint8Array([0xdb, 0x82]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(39, 0, show(() => d.decode(new Uint8Array([0xe1, 0x9f]), { stream: true })));
  console.log(39, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(40, 0, show(() => d.decode(new Uint8Array([0xef, 0xac, 0xff, 0xa0]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(41, 0, show(() => d.decode(new Uint8Array([0xff]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(42, 0, show(() => d.decode()));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(43, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(43, 1, show(() => d.decode(new Uint8Array([0x82, 0x41, 0x8f, 0x41]), { stream: false })));
  console.log(43, 2, show(() => d.decode(new Uint8Array([0xbb]), { stream: true })));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(44, 0, show(() => d.decode(new Uint8Array([0x0]))));
  console.log(44, 1, show(() => d.decode(new Uint8Array([0xfe, 0xff]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(45, 0, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(45, 1, show(() => d.decode(new Uint8Array([0xe0, 0xbf]), undefined)));
  console.log(45, 2, show(() => d.decode(new Uint8Array([]), null as any)));
  console.log(45, 3, show(() => d.decode(new Uint8Array([0xff]), { stream: true })));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(46, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(46, 1, show(() => d.decode(new Uint8Array([0x80, 0xac, 0xdf, 0x0]), { stream: true })));
  console.log(46, 2, show(() => d.decode(undefined, { stream: false })));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(47, 0, show(() => d.decode(new Uint8Array([0xdc, 0xdc, 0xe0]), null as any)));
  console.log(47, 1, show(() => d.decode(new Uint8Array([0xc2]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(48, 0, show(() => d.decode(new Uint8Array([0xfe]), { stream: true })));
  console.log(48, 1, show(() => d.decode(new Uint8Array([]))));
  console.log(48, 2, show(() => d.decode(new Uint8Array([0xf4, 0xdb]))));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(49, 0, show(() => d.decode(new Uint8Array([0x7f]), { stream: true })));
  console.log(49, 1, show(() => d.decode(new Uint8Array([0x80, 0xdc, 0xff, 0xe9]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(50, 0, show(() => d.decode(new Uint8Array([0xbf, 0xbb, 0xbf]), { stream: true })));
  console.log(50, 1, show(() => d.decode(new Uint8Array([0xc0]), undefined)));
  console.log(50, 2, show(() => d.decode(new Uint8Array([0xdf, 0xc0]), { stream: false })));
}
{
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log(51, 0, show(() => d.decode(new Uint8Array([0xa0, 0xf5, 0xf5, 0x9f]), undefined)));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(52, 0, show(() => d.decode(new Uint8Array([0xf4, 0xed]), undefined)));
  console.log(52, 1, show(() => d.decode(new Uint8Array([0xfe, 0x80, 0x80]), { stream: true })));
  console.log(52, 2, show(() => d.decode(new Uint8Array([]), null as any)));
  console.log(52, 3, show(() => d.decode(new Uint8Array([0x8f]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(53, 0, show(() => d.decode(new Uint8Array([0xbb, 0xef]), { stream: true })));
  console.log(53, 1, show(() => d.decode(new Uint8Array([0x98, 0x41, 0xf4, 0x8f]), { stream: true })));
  console.log(53, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(54, 0, show(() => d.decode(new Uint8Array([0xf5, 0xe9, 0x90]), { stream: true })));
  console.log(54, 1, show(() => d.decode(new Uint8Array([0x3d, 0x3d]))));
  console.log(54, 2, show(() => d.decode(new Uint8Array([0x0, 0xac, 0x9f, 0xf5]), { stream: false })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(55, 0, show(() => d.decode(new Uint8Array([0xd8, 0xe0, 0x7f, 0x9f]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(56, 0, show(() => d.decode(new Uint8Array([0x90]), null as any)));
  console.log(56, 1, show(() => d.decode()));
  console.log(56, 2, show(() => d.decode(new Uint8Array([0xd8]), null as any)));
  console.log(56, 3, show(() => d.decode(new Uint8Array([0xe0]), undefined)));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(57, 0, show(() => d.decode(new Uint8Array([0xff, 0xac, 0x9f, 0x98]), { stream: false })));
  console.log(57, 1, show(() => d.decode(new Uint8Array([0x82, 0xf5, 0xc0, 0xbf]))));
  console.log(57, 2, show(() => d.decode(new Uint8Array([0x80, 0xbb]), undefined)));
  console.log(57, 3, show(() => d.decode(new Uint8Array([0x41, 0x0, 0x9f, 0xdf]))));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(58, 0, show(() => d.decode(new Uint8Array([0x82, 0xef, 0xac, 0x80]), { stream: true })));
  console.log(58, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(58, 2, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(59, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(59, 1, show(() => d.decode(new Uint8Array([0x41, 0xed, 0xff, 0xd8]), null as any)));
  console.log(59, 2, show(() => d.decode(new Uint8Array([0xbf]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(60, 0, show(() => d.decode(new Uint8Array([0xdf, 0xbb, 0x9f]), { stream: false })));
  console.log(60, 1, show(() => d.decode(new Uint8Array([0x9f]), { stream: true })));
  console.log(60, 2, show(() => d.decode(new Uint8Array([0xf5, 0xf4]), undefined)));
  console.log(60, 3, show(() => d.decode(new Uint8Array([0xbf]))));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(61, 0, show(() => d.decode(new Uint8Array([0xe0, 0x0, 0xef, 0xef]), { stream: true })));
  console.log(61, 1, show(() => d.decode(new Uint8Array([0xbb]), { stream: true })));
  console.log(61, 2, show(() => d.decode(new Uint8Array([0xd8, 0xa0]), { stream: false })));
  console.log(61, 3, show(() => d.decode(new Uint8Array([0xbb]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(62, 0, show(() => d.decode(undefined, { stream: true })));
  console.log(62, 1, show(() => d.decode(new Uint8Array([0x80, 0xc2]))));
  console.log(62, 2, show(() => d.decode(new Uint8Array([0xdf, 0xbb, 0xdb, 0xe9]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(63, 0, show(() => d.decode(new Uint8Array([0xdf, 0x3d]))));
  console.log(63, 1, show(() => d.decode(new Uint8Array([0xdf, 0x8f, 0xde]), { stream: true })));
  console.log(63, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(63, 3, show(() => d.decode(new Uint8Array([0xa0, 0x8f]))));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(64, 0, show(() => d.decode(new Uint8Array([0xe9, 0xdf, 0xbf, 0x8f]), { stream: true })));
  console.log(64, 1, show(() => d.decode(new Uint8Array([0xed, 0xbb, 0xe0, 0xdc]), null as any)));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(65, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(66, 0, show(() => d.decode(new Uint8Array([0xe9, 0xed, 0xe0]), { stream: true })));
  console.log(66, 1, show(() => d.decode(new Uint8Array([0x41]), { stream: true })));
  console.log(66, 2, show(() => d.decode(new Uint8Array([0xbb]), { stream: true })));
  console.log(66, 3, show(() => d.decode(undefined, { stream: true })));
}
{
  const d = new TextDecoder("koi8-r", { fatal: true });
  console.log(67, 0, show(() => d.decode(new Uint8Array([0xe9, 0xff]))));
  console.log(67, 1, show(() => d.decode(new Uint8Array([0xe0, 0xf5, 0xf0]), { stream: true })));
  console.log(67, 2, show(() => d.decode(new Uint8Array([0x9f, 0xbb, 0x82]), undefined)));
}
{
  const d = new TextDecoder("koi8-r", { fatal: true });
  console.log(68, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(68, 1, show(() => d.decode(new Uint8Array([0xde, 0xbb, 0x98, 0xf0]), { stream: true })));
  console.log(68, 2, show(() => d.decode(new Uint8Array([0xdf, 0x90]), { stream: true })));
  console.log(68, 3, show(() => d.decode(new Uint8Array([0xbf, 0xdf, 0x3d, 0xed]), undefined)));
}
{
  const d = new TextDecoder("koi8-r", { fatal: true });
  console.log(69, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(69, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(70, 0, show(() => d.decode(new Uint8Array([0xff, 0x0, 0xbf, 0x3d]), { stream: true })));
  console.log(70, 1, show(() => d.decode(new Uint8Array([0xc0, 0x80]))));
  console.log(70, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(70, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(71, 0, show(() => d.decode(new Uint8Array([0xf4, 0xf5, 0x0, 0xdb]), undefined)));
  console.log(71, 1, show(() => d.decode(new Uint8Array([0xbf, 0x7f, 0xa0]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(72, 0, show(() => d.decode(new Uint8Array([0x41]), { stream: false })));
  console.log(72, 1, show(() => d.decode(new Uint8Array([0xbf]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(73, 0, show(() => d.decode(new Uint8Array([0x80, 0xde, 0xdb]))));
  console.log(73, 1, show(() => d.decode(new Uint8Array([0xed]), { stream: true })));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(74, 0, show(() => d.decode(new Uint8Array([0xf5]), undefined)));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(75, 0, show(() => d.decode(new Uint8Array([0xc2]), { stream: true })));
  console.log(75, 1, show(() => d.decode(new Uint8Array([0xf5, 0xdf]), { stream: false })));
  console.log(75, 2, show(() => d.decode(new Uint8Array([0xef, 0xdb, 0xf0]), null as any)));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(76, 0, show(() => d.decode(new Uint8Array([0xac, 0xfe, 0xf4, 0x98]), undefined)));
  console.log(76, 1, show(() => d.decode(new Uint8Array([]))));
  console.log(76, 2, show(() => d.decode(new Uint8Array([0xe1, 0xbb]), { stream: true })));
  console.log(76, 3, show(() => d.decode(new Uint8Array([0xf5, 0xd8, 0x3d]), { stream: true })));
}
{
  const d = new TextDecoder("koi8-r", { fatal: true });
  console.log(77, 0, show(() => d.decode(new Uint8Array([0xff, 0xdf]), { stream: true })));
  console.log(77, 1, show(() => d.decode(new Uint8Array([0xfe, 0x0]))));
  console.log(77, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(77, 3, show(() => d.decode(new Uint8Array([0xff, 0xa0, 0x80]))));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(78, 0, show(() => d.decode(new Uint8Array([0xbf, 0x82, 0xff]))));
}
{
  const d = new TextDecoder("utf-8");
  console.log(79, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(79, 1, show(() => d.decode(new Uint8Array([0xdc]), { stream: false })));
  console.log(79, 2, show(() => d.decode(new Uint8Array([0xe1, 0x90]), { stream: false })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(80, 0, show(() => d.decode(new Uint8Array([0xe9, 0x80]), { stream: true })));
  console.log(80, 1, show(() => d.decode(new Uint8Array([0x90, 0x41, 0xa0]), { stream: true })));
  console.log(80, 2, show(() => d.decode(new Uint8Array([0xff]), { stream: true })));
  console.log(80, 3, show(() => d.decode(new Uint8Array([0xd8, 0xe0]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(81, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(81, 1, show(() => d.decode(new Uint8Array([0xe0, 0xde, 0xdb]), { stream: false })));
  console.log(81, 2, show(() => d.decode(new Uint8Array([0xd8, 0xc0, 0xc2]), { stream: false })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(82, 0, show(() => d.decode(new Uint8Array([0xe1]), null as any)));
  console.log(82, 1, show(() => d.decode(new Uint8Array([0xac]), undefined)));
  console.log(82, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(83, 0, show(() => d.decode(new Uint8Array([0xf5]), { stream: true })));
  console.log(83, 1, show(() => d.decode(new Uint8Array([0x90, 0xdc]), undefined)));
  console.log(83, 2, show(() => d.decode(new Uint8Array([0xff, 0xc2]), { stream: true })));
  console.log(83, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(84, 0, show(() => d.decode(new Uint8Array([0xf4, 0xd8]), { stream: false })));
  console.log(84, 1, show(() => d.decode(new Uint8Array([0xc2, 0x98, 0xdf]), { stream: true })));
  console.log(84, 2, show(() => d.decode(new Uint8Array([0xff, 0xf5, 0xff, 0x82]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(85, 0, show(() => d.decode(new Uint8Array([0x80, 0xbf, 0xdf, 0xff]))));
  console.log(85, 1, show(() => d.decode(new Uint8Array([0x90]), { stream: true })));
  console.log(85, 2, show(() => d.decode(undefined, { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(86, 0, show(() => d.decode(new Uint8Array([0xdc, 0xe9, 0x82, 0x82]), { stream: true })));
  console.log(86, 1, show(() => d.decode(new Uint8Array([0xe9]), null as any)));
  console.log(86, 2, show(() => d.decode(new Uint8Array([0xed, 0xef, 0xbf, 0xbb]), null as any)));
  console.log(86, 3, show(() => d.decode(new Uint8Array([0xbb, 0x98]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(87, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(87, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(87, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(88, 0, show(() => d.decode(new Uint8Array([0xf4, 0xa0, 0xf4, 0xdf]), { stream: true })));
  console.log(88, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(88, 2, show(() => d.decode(new Uint8Array([0xdc, 0x7f]), { stream: false })));
}
{
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log(89, 0, show(() => d.decode(new Uint8Array([0xbb, 0xf5, 0xe9, 0xbb]), { stream: true })));
  console.log(89, 1, show(() => d.decode(new Uint8Array([]), null as any)));
  console.log(89, 2, show(() => d.decode(new Uint8Array([0xff]), { stream: true })));
  console.log(89, 3, show(() => d.decode(new Uint8Array([0xe0, 0xbb, 0xdf, 0xe0]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(90, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(90, 1, show(() => d.decode(new Uint8Array([0x82, 0x82, 0xdf, 0x82]), { stream: true })));
  console.log(90, 2, show(() => d.decode(new Uint8Array([0xdb, 0xf0]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(91, 0, show(() => d.decode(new Uint8Array([0x3d, 0xdb, 0xff, 0xc0]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(92, 0, show(() => d.decode(new Uint8Array([0xdb, 0xed, 0x3d]), undefined)));
  console.log(92, 1, show(() => d.decode(new Uint8Array([0xf4]), { stream: true })));
  console.log(92, 2, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(93, 0, show(() => d.decode(new Uint8Array([0xdb, 0xff, 0x80]), undefined)));
  console.log(93, 1, show(() => d.decode(undefined, undefined)));
  console.log(93, 2, show(() => d.decode(new Uint8Array([0x98, 0xc0, 0x3d, 0x90]), undefined)));
}
{
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log(94, 0, show(() => d.decode(new Uint8Array([0x82, 0x8f, 0xac, 0xbf]), { stream: true })));
  console.log(94, 1, show(() => d.decode(new Uint8Array([0x90, 0xd8, 0x9f]), { stream: false })));
  console.log(94, 2, show(() => d.decode(new Uint8Array([0xbb, 0xfe]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(95, 0, show(() => d.decode(new Uint8Array([0xbb, 0xbb, 0xd8]), { stream: true })));
  console.log(95, 1, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(95, 2, show(() => d.decode(new Uint8Array([0xe9, 0xbb, 0xdf]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(96, 0, show(() => d.decode(new Uint8Array([0xe9, 0xf5, 0xfe, 0xdc]), { stream: true })));
  console.log(96, 1, show(() => d.decode(new Uint8Array([0xac, 0x0]), { stream: true })));
  console.log(96, 2, show(() => d.decode(new Uint8Array([0x8f, 0xdb, 0x41, 0x8f]), { stream: true })));
  console.log(96, 3, show(() => d.decode(new Uint8Array([0xe9, 0xbf]), undefined)));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(97, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(97, 1, show(() => d.decode(new Uint8Array([0xf4, 0xfe, 0xde]))));
  console.log(97, 2, show(() => d.decode(undefined, { stream: false })));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(98, 0, show(() => d.decode(new Uint8Array([0xff, 0xdf]), { stream: true })));
  console.log(98, 1, show(() => d.decode(new Uint8Array([0xed, 0xdb, 0x8f]))));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(99, 0, show(() => d.decode(undefined, { stream: false })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(100, 0, show(() => d.decode(new Uint8Array([0x0, 0xf4, 0x90, 0x7f]), { stream: false })));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(101, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(102, 0, show(() => d.decode(new Uint8Array([0xc0]), { stream: false })));
  console.log(102, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(102, 2, show(() => d.decode(new Uint8Array([0xfe, 0xd8, 0x80]), undefined)));
}
{
  const d = new TextDecoder("utf-8");
  console.log(103, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(103, 1, show(() => d.decode(new Uint8Array([0x7f, 0xe9, 0xdf, 0xed]), { stream: false })));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(104, 0, show(() => d.decode(new Uint8Array([0xdb]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(105, 0, show(() => d.decode(new Uint8Array([0xff]), { stream: true })));
  console.log(105, 1, show(() => d.decode(new Uint8Array([0xdf, 0xe0, 0x8f]), { stream: true })));
  console.log(105, 2, show(() => d.decode(new Uint8Array([0xdb, 0xe9]), { stream: false })));
  console.log(105, 3, show(() => d.decode(new Uint8Array([0x8f, 0xef, 0xde, 0x9f]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(106, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(106, 1, show(() => d.decode(new Uint8Array([0xdf, 0x8f, 0xbb, 0xdf]), { stream: true })));
  console.log(106, 2, show(() => d.decode(new Uint8Array([]))));
  console.log(106, 3, show(() => d.decode(new Uint8Array([0x9f]), { stream: true })));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(107, 0, show(() => d.decode(new Uint8Array([0xbb]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(108, 0, show(() => d.decode(undefined, { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(109, 0, show(() => d.decode(new Uint8Array([0x98, 0xff]), { stream: false })));
  console.log(109, 1, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(109, 2, show(() => d.decode(new Uint8Array([0x80, 0x82, 0xed, 0xef]), { stream: true })));
  console.log(109, 3, show(() => d.decode(new Uint8Array([0xac, 0xdc]), undefined)));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(110, 0, show(() => d.decode(new Uint8Array([0x90, 0x9f]), undefined)));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(111, 0, show(() => d.decode(new Uint8Array([0xac, 0xfe, 0xa0, 0xd8]), null as any)));
  console.log(111, 1, show(() => d.decode(new Uint8Array([0xe1, 0xbb, 0xef, 0xff]), undefined)));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(112, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log(113, 0, show(() => d.decode(new Uint8Array([0xd8, 0x9f]), null as any)));
  console.log(113, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(114, 0, show(() => d.decode(new Uint8Array([0xde, 0xa0, 0xc2, 0xdf]), { stream: true })));
  console.log(114, 1, show(() => d.decode(new Uint8Array([]))));
  console.log(114, 2, show(() => d.decode(new Uint8Array([0xbb]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(115, 0, show(() => d.decode(new Uint8Array([0xff, 0x9f, 0xe0]), { stream: true })));
  console.log(115, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(115, 2, show(() => d.decode(new Uint8Array([0x8f]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(116, 0, show(() => d.decode(new Uint8Array([]), null as any)));
  console.log(116, 1, show(() => d.decode(new Uint8Array([0xdb]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(117, 0, show(() => d.decode(new Uint8Array([0x90, 0xdf]), undefined)));
  console.log(117, 1, show(() => d.decode(new Uint8Array([0x82, 0xdf, 0xa0, 0xa0]), { stream: true })));
  console.log(117, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(117, 3, show(() => d.decode(new Uint8Array([0x8f, 0xdb]), null as any)));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(118, 0, show(() => d.decode(new Uint8Array([0xe0, 0xd8, 0xe9, 0xbb]), undefined)));
  console.log(118, 1, show(() => d.decode(undefined, null as any)));
  console.log(118, 2, show(() => d.decode(new Uint8Array([0x98, 0xe9]))));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(119, 0, show(() => d.decode(new Uint8Array([0x82, 0xdb, 0x9f]))));
  console.log(119, 1, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log(120, 0, show(() => d.decode(new Uint8Array([]), null as any)));
  console.log(120, 1, show(() => d.decode(new Uint8Array([0xd8, 0xff, 0xf0]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(121, 0, show(() => d.decode(new Uint8Array([0x8f]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(122, 0, show(() => d.decode(new Uint8Array([0x90, 0x80]), { stream: false })));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(123, 0, show(() => d.decode(new Uint8Array([0xfe]))));
  console.log(123, 1, show(() => d.decode(new Uint8Array([0x82]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(124, 0, show(() => d.decode(undefined, null as any)));
  console.log(124, 1, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(124, 2, show(() => d.decode(new Uint8Array([0xef]), { stream: false })));
  console.log(124, 3, show(() => d.decode(undefined, { stream: true })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(125, 0, show(() => d.decode(undefined, null as any)));
  console.log(125, 1, show(() => d.decode(new Uint8Array([0xf0, 0x8f]), null as any)));
  console.log(125, 2, show(() => d.decode(undefined, { stream: true })));
  console.log(125, 3, show(() => d.decode(new Uint8Array([0x41, 0xdf, 0xe1, 0xbb]))));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(126, 0, show(() => d.decode(new Uint8Array([0xc2]), { stream: true })));
  console.log(126, 1, show(() => d.decode(new Uint8Array([0x3d]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(127, 0, show(() => d.decode(new Uint8Array([0x9f]), { stream: false })));
  console.log(127, 1, show(() => d.decode(new Uint8Array([0xe0, 0xdf]), { stream: true })));
  console.log(127, 2, show(() => d.decode(new Uint8Array([0x80, 0xc2]), { stream: false })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(128, 0, show(() => d.decode(new Uint8Array([]), undefined)));
}
{
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log(129, 0, show(() => d.decode(new Uint8Array([0x7f]), undefined)));
  console.log(129, 1, show(() => d.decode(new Uint8Array([0xff, 0xbb, 0xf4]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(130, 0, show(() => d.decode(new Uint8Array([0xdc]), { stream: false })));
  console.log(130, 1, show(() => d.decode(new Uint8Array([0x9f]), { stream: false })));
  console.log(130, 2, show(() => d.decode(new Uint8Array([0xe1, 0xdc, 0xf4]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(131, 0, show(() => d.decode(new Uint8Array([0xde]))));
}
{
  const d = new TextDecoder("windows-1252");
  console.log(132, 0, show(() => d.decode(new Uint8Array([0xe9]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(133, 0, show(() => d.decode(new Uint8Array([0x8f]), undefined)));
  console.log(133, 1, show(() => d.decode(new Uint8Array([0xa0]), null as any)));
}
{
  const d = new TextDecoder("utf-16le", { fatal: true });
  console.log(134, 0, show(() => d.decode(new Uint8Array([0xbb, 0xe1, 0xf5, 0x3d]), { stream: true })));
  console.log(134, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(134, 2, show(() => d.decode(new Uint8Array([0xff]), { stream: true })));
  console.log(134, 3, show(() => d.decode(new Uint8Array([0xa0]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(135, 0, show(() => d.decode(new Uint8Array([]), undefined)));
}
{
  const d = new TextDecoder("koi8-r", { fatal: true });
  console.log(136, 0, show(() => d.decode(new Uint8Array([0xde, 0xa0, 0xff]), { stream: false })));
  console.log(136, 1, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(136, 2, show(() => d.decode(new Uint8Array([0x3d, 0x82, 0xe0, 0xac]))));
  console.log(136, 3, show(() => d.decode(new Uint8Array([0xed, 0xe1]), { stream: true })));
}
{
  const d = new TextDecoder("koi8-r", { fatal: true });
  console.log(137, 0, show(() => d.decode(new Uint8Array([0x80, 0xbb, 0x3d, 0xff]), { stream: true })));
  console.log(137, 1, show(() => d.decode(new Uint8Array([0xe9, 0xff, 0xf5]), { stream: true })));
  console.log(137, 2, show(() => d.decode(new Uint8Array([0x3d, 0xe9, 0x98, 0xc0]), { stream: false })));
  console.log(137, 3, show(() => d.decode(new Uint8Array([]), null as any)));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(138, 0, show(() => d.decode(undefined, null as any)));
  console.log(138, 1, show(() => d.decode(new Uint8Array([0xed]), null as any)));
  console.log(138, 2, show(() => d.decode(new Uint8Array([0xdf, 0xed, 0xd8, 0xc0]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16be");
  console.log(139, 0, show(() => d.decode(new Uint8Array([]), null as any)));
  console.log(139, 1, show(() => d.decode(new Uint8Array([0xac, 0xff, 0xff]), { stream: true })));
  console.log(139, 2, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(139, 3, show(() => d.decode(new Uint8Array([0x9f, 0xbb, 0xde]), { stream: true })));
}
{
  const d = new TextDecoder("utf-16le");
  console.log(140, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(140, 1, show(() => d.decode(new Uint8Array([0xbf]), null as any)));
}
{
  const d = new TextDecoder("utf-8");
  console.log(141, 0, show(() => d.decode(new Uint8Array([]), undefined)));
}
{
  const d = new TextDecoder("utf-8");
  console.log(142, 0, show(() => d.decode(new Uint8Array([0x8f, 0xe0, 0xdf, 0xfe]), { stream: true })));
  console.log(142, 1, show(() => d.decode(new Uint8Array([0xf5, 0xff, 0xe0]), undefined)));
}
{
  const d = new TextDecoder("utf-16be", { fatal: true });
  console.log(143, 0, show(() => d.decode(new Uint8Array([0xf5, 0x8f, 0xdf, 0xf4]), { stream: false })));
  console.log(143, 1, show(() => d.decode(new Uint8Array([0xc2, 0x80]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log(144, 0, show(() => d.decode(new Uint8Array([0xf5, 0x0, 0xdf, 0xbf]), { stream: true })));
  console.log(144, 1, show(() => d.decode(new Uint8Array([0x0, 0x0]), { stream: true })));
  console.log(144, 2, show(() => d.decode(new Uint8Array([0xd8, 0xde]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(145, 0, show(() => d.decode(new Uint8Array([0x9f, 0xff]), { stream: true })));
  console.log(145, 1, show(() => d.decode(new Uint8Array([0xbf, 0xbb, 0xf4, 0xdf]), { stream: false })));
  console.log(145, 2, show(() => d.decode(new Uint8Array([0xf0, 0xe0, 0xc0]), null as any)));
}
{
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log(146, 0, show(() => d.decode(new Uint8Array([0xa0, 0xef]), { stream: false })));
  console.log(146, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { fatal: true });
  console.log(147, 0, show(() => d.decode()));
  console.log(147, 1, show(() => d.decode(new Uint8Array([0x80, 0xed, 0x80]), undefined)));
  console.log(147, 2, show(() => d.decode(new Uint8Array([0xac, 0x98]), { stream: false })));
  console.log(147, 3, show(() => d.decode(new Uint8Array([0xa0, 0xbf, 0xbf]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8");
  console.log(148, 0, show(() => d.decode(new Uint8Array([0xde, 0x80]), { stream: true })));
  console.log(148, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("utf-8", { ignoreBOM: true });
  console.log(149, 0, show(() => d.decode(new Uint8Array([0x3d, 0xe9]), { stream: false })));
}
