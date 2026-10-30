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
  const d = new TextDecoder("gbk");
  console.log(0, 0, show(() => d.decode(new Uint8Array([0xb0, 0x7f, 0x80, 0x5c, 0x5f]), { stream: true })));
  console.log(0, 1, show(() => d.decode(new Uint8Array([0xf, 0xfe]))));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(1, 0, show(() => d.decode(new Uint8Array([0xa0, 0x7b]))));
  console.log(1, 1, show(() => d.decode(new Uint8Array([0xc4, 0xfe, 0x5c, 0xfd, 0x1b]), { stream: false })));
  console.log(1, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(1, 3, show(() => d.decode(new Uint8Array([0x5c, 0xfe, 0x80]))));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(2, 0, show(() => d.decode(new Uint8Array([0xfc, 0x8f, 0x24, 0xe5, 0x9b]), undefined)));
  console.log(2, 1, show(() => d.decode(new Uint8Array([0x7f, 0xdf, 0x7e, 0x7b, 0x7e]), { stream: false })));
  console.log(2, 2, show(() => d.decode(new Uint8Array([0x81]), { stream: false })));
  console.log(2, 3, show(() => d.decode(new Uint8Array([0x24, 0x7e]), { stream: true })));
  console.log(2, 4, show(() => d.decode(new Uint8Array([0x7e, 0x28]), { stream: false })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(3, 0, show(() => d.decode(new Uint8Array([0x5c, 0xb0, 0x24]), { stream: true })));
  console.log(3, 1, show(() => d.decode(new Uint8Array([0xfc, 0x80, 0x2e]), undefined)));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(4, 0, show(() => d.decode(new Uint8Array([0x8e, 0x20]), { stream: false })));
  console.log(4, 1, show(() => d.decode(new Uint8Array([0xb0, 0x24, 0xdf]), { stream: true })));
  console.log(4, 2, show(() => d.decode(new Uint8Array([0x2e, 0xa0, 0xa0, 0xa1, 0xd]), { stream: true })));
  console.log(4, 3, show(() => d.decode(new Uint8Array([0xff, 0x9f]), { stream: false })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(5, 0, show(() => d.decode(new Uint8Array([0x7f, 0xa0, 0x7f]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(6, 0, show(() => d.decode(new Uint8Array([0x8e, 0x2e, 0x0, 0x30, 0xa]))));
  console.log(6, 1, show(() => d.decode(new Uint8Array([0x8e, 0xbe]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(7, 0, show(() => d.decode(new Uint8Array([0x9f, 0xfd, 0xa, 0x41]), { stream: false })));
  console.log(7, 1, show(() => d.decode(new Uint8Array([0xe0, 0x21, 0x39]), undefined)));
  console.log(7, 2, show(() => d.decode(new Uint8Array([0xf, 0x5f, 0xfc, 0x7f]), { stream: true })));
  console.log(7, 3, show(() => d.decode(new Uint8Array([0xdf, 0xa0]), { stream: true })));
  console.log(7, 4, show(() => d.decode(undefined, { stream: true })));
}
{
  const d = new TextDecoder("big5");
  console.log(8, 0, show(() => d.decode(new Uint8Array([0xe5, 0x5f, 0xe, 0x20]), { stream: false })));
}
{
  const d = new TextDecoder("big5");
  console.log(9, 0, show(() => d.decode(new Uint8Array([]))));
  console.log(9, 1, show(() => d.decode(new Uint8Array([0x0, 0xe0, 0x81, 0x9b]), { stream: true })));
  console.log(9, 2, show(() => d.decode(new Uint8Array([0xc4, 0xdf, 0xff, 0x5f, 0xff]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(10, 0, show(() => d.decode(new Uint8Array([0x39, 0x7b, 0xe0, 0xfd]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(11, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(11, 1, show(() => d.decode(new Uint8Array([0x39, 0xfc]), { stream: true })));
  console.log(11, 2, show(() => d.decode(new Uint8Array([0x1b, 0x81, 0x28, 0x80]))));
  console.log(11, 3, show(() => d.decode(new Uint8Array([0xe0, 0xd]))));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(12, 0, show(() => d.decode(new Uint8Array([0x21, 0xfe, 0xf, 0x24]))));
  console.log(12, 1, show(() => d.decode(new Uint8Array([0xa0, 0x2e, 0x8e, 0xd, 0x20]), { stream: true })));
  console.log(12, 2, show(() => d.decode(new Uint8Array([0xe0]), undefined)));
  console.log(12, 3, show(() => d.decode(new Uint8Array([0xdf, 0xe0, 0x81, 0x41, 0xa]), { stream: true })));
  console.log(12, 4, show(() => d.decode(new Uint8Array([0xa0, 0x41, 0xfe, 0xf, 0x5f]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(13, 0, show(() => d.decode(new Uint8Array([0x1b]), { stream: false })));
  console.log(13, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(13, 2, show(() => d.decode(new Uint8Array([0xdf, 0xdf, 0xd, 0x39, 0xfe]), { stream: true })));
  console.log(13, 3, show(() => d.decode(new Uint8Array([0x21, 0x8f]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(14, 0, show(() => d.decode(new Uint8Array([0x5c, 0x2e]))));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(15, 0, show(() => d.decode(new Uint8Array([0xbe]), { stream: true })));
  console.log(15, 1, show(() => d.decode(new Uint8Array([0x7f, 0xff]), { stream: false })));
  console.log(15, 2, show(() => d.decode(new Uint8Array([0x81, 0xdf, 0xa, 0xa1, 0x28]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(16, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(16, 1, show(() => d.decode(new Uint8Array([0xdf]), { stream: true })));
  console.log(16, 2, show(() => d.decode(new Uint8Array([0xfc, 0xe5, 0x28]), { stream: true })));
  console.log(16, 3, show(() => d.decode(new Uint8Array([0xe0]), { stream: true })));
  console.log(16, 4, show(() => d.decode(new Uint8Array([0xf0, 0x39, 0x39, 0xdf]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(17, 0, show(() => d.decode(new Uint8Array([0xf0]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(18, 0, show(() => d.decode(new Uint8Array([0x39, 0x81, 0x7b, 0x24, 0xa]), undefined)));
  console.log(18, 1, show(() => d.decode(new Uint8Array([0xe5, 0x20]), { stream: true })));
}
{
  const d = new TextDecoder("gbk");
  console.log(19, 0, show(() => d.decode(new Uint8Array([0x39, 0x7e, 0xfd, 0x40]))));
  console.log(19, 1, show(() => d.decode(new Uint8Array([0xe5, 0x5f]), { stream: false })));
  console.log(19, 2, show(() => d.decode(new Uint8Array([0xdf, 0x80, 0x21, 0xe, 0x7f]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(20, 0, show(() => d.decode(new Uint8Array([0xe0, 0xdf, 0x20, 0x7f]), { stream: false })));
  console.log(20, 1, show(() => d.decode(new Uint8Array([0x39, 0xe5, 0x7f]), { stream: true })));
  console.log(20, 2, show(() => d.decode(new Uint8Array([0x30, 0x39]), { stream: true })));
}
{
  const d = new TextDecoder("big5");
  console.log(21, 0, show(() => d.decode(new Uint8Array([0xfd, 0xb0, 0x2e]), { stream: false })));
  console.log(21, 1, show(() => d.decode(new Uint8Array([0x28, 0x30, 0x3f]))));
  console.log(21, 2, show(() => d.decode(new Uint8Array([0x24, 0x5c, 0x7f]), { stream: true })));
  console.log(21, 3, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(21, 4, show(() => d.decode(new Uint8Array([0x7e, 0xdf, 0x7e, 0x0, 0xb0]), undefined)));
}
{
  const d = new TextDecoder("gb18030");
  console.log(22, 0, show(() => d.decode(new Uint8Array([0xbe, 0x5c, 0xa0, 0x5c]), { stream: true })));
  console.log(22, 1, show(() => d.decode(new Uint8Array([0xdf, 0xa0, 0xbe, 0xa0, 0x39]), { stream: true })));
  console.log(22, 2, show(() => d.decode(new Uint8Array([0x30, 0x9b]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(23, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(24, 0, show(() => d.decode(new Uint8Array([0xa0]), { stream: true })));
  console.log(24, 1, show(() => d.decode(new Uint8Array([0xe5, 0x9f, 0xa0, 0x3f, 0x7e]), { stream: true })));
  console.log(24, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(24, 3, show(() => d.decode(new Uint8Array([]), undefined)));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(25, 0, show(() => d.decode(undefined, { stream: true })));
  console.log(25, 1, show(() => d.decode(undefined, { stream: false })));
  console.log(25, 2, show(() => d.decode(new Uint8Array([0xa1, 0xfe]), undefined)));
  console.log(25, 3, show(() => d.decode(new Uint8Array([0x5f, 0xc4]), { stream: false })));
  console.log(25, 4, show(() => d.decode(new Uint8Array([0x39, 0xfd, 0x8f, 0x41, 0x41]))));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(26, 0, show(() => d.decode(new Uint8Array([0x30]), { stream: true })));
  console.log(26, 1, show(() => d.decode(new Uint8Array([0x21, 0x5f, 0x81, 0xfc]))));
  console.log(26, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(27, 0, show(() => d.decode(new Uint8Array([0xe]), undefined)));
  console.log(27, 1, show(() => d.decode(new Uint8Array([0x5c, 0xdf, 0x40]))));
  console.log(27, 2, show(() => d.decode(new Uint8Array([0x30, 0xdf]), undefined)));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(28, 0, show(() => d.decode(new Uint8Array([0xa1, 0x7e]))));
  console.log(28, 1, show(() => d.decode(new Uint8Array([0x3f, 0x20]), { stream: true })));
  console.log(28, 2, show(() => d.decode(new Uint8Array([0x28]), { stream: true })));
  console.log(28, 3, show(() => d.decode(new Uint8Array([0xa1, 0xfe, 0xfc]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(29, 0, show(() => d.decode(new Uint8Array([]))));
  console.log(29, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(29, 2, show(() => d.decode(new Uint8Array([0xc4, 0x9b, 0xfe, 0x3f, 0xfe]), { stream: true })));
  console.log(29, 3, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(30, 0, show(() => d.decode(new Uint8Array([0xe0]), { stream: true })));
  console.log(30, 1, show(() => d.decode(new Uint8Array([0x81, 0xc4, 0x8f, 0x5f]), { stream: true })));
  console.log(30, 2, show(() => d.decode(new Uint8Array([0x9b, 0xf, 0x40, 0x20]))));
  console.log(30, 3, show(() => d.decode(new Uint8Array([0x5f, 0xa, 0x28, 0x5c, 0x81]), { stream: true })));
  console.log(30, 4, show(() => d.decode(new Uint8Array([]))));
}
{
  const d = new TextDecoder("gbk");
  console.log(31, 0, show(() => d.decode(undefined, { stream: true })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(32, 0, show(() => d.decode(new Uint8Array([0xfd, 0xa1, 0x20, 0x81]), { stream: true })));
  console.log(32, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(32, 2, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(32, 3, show(() => d.decode(new Uint8Array([0x1b, 0xdf]), undefined)));
  console.log(32, 4, show(() => d.decode(new Uint8Array([0x8e, 0xc4, 0x8e, 0x28, 0x3f]), undefined)));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(33, 0, show(() => d.decode(new Uint8Array([0x7b, 0x5f]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(34, 0, show(() => d.decode(new Uint8Array([0x80, 0xa0, 0xc4, 0xa, 0x8e]))));
  console.log(34, 1, show(() => d.decode(new Uint8Array([0x24, 0x40, 0xff]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(35, 0, show(() => d.decode(new Uint8Array([0xa1, 0xd, 0x24, 0xe5, 0x9b]), undefined)));
  console.log(35, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(35, 2, show(() => d.decode(new Uint8Array([0xff, 0xdf, 0x7b]), { stream: true })));
}
{
  const d = new TextDecoder("big5");
  console.log(36, 0, show(() => d.decode(new Uint8Array([0xdf, 0xa, 0x3f, 0x39]), { stream: true })));
  console.log(36, 1, show(() => d.decode(new Uint8Array([0x8e, 0x41]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(37, 0, show(() => d.decode(new Uint8Array([0xa]), undefined)));
}
{
  const d = new TextDecoder("big5");
  console.log(38, 0, show(() => d.decode(new Uint8Array([0x8f, 0x20, 0xa0, 0x7f]), { stream: true })));
}
{
  const d = new TextDecoder("big5");
  console.log(39, 0, show(() => d.decode(new Uint8Array([0x9f]), { stream: true })));
  console.log(39, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(39, 2, show(() => d.decode(new Uint8Array([0x7f, 0x8e]), { stream: true })));
  console.log(39, 3, show(() => d.decode(new Uint8Array([0x3f, 0x80, 0xa1]), undefined)));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(40, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(40, 1, show(() => d.decode(undefined, { stream: false })));
  console.log(40, 2, show(() => d.decode(new Uint8Array([0xdf, 0x1b, 0x3f, 0x20]), { stream: true })));
  console.log(40, 3, show(() => d.decode(new Uint8Array([0xa1, 0xfc, 0xf, 0x30, 0x41]), { stream: true })));
}
{
  const d = new TextDecoder("big5");
  console.log(41, 0, show(() => d.decode(new Uint8Array([0xb0, 0xf0, 0x21, 0x81]), { stream: true })));
  console.log(41, 1, show(() => d.decode(new Uint8Array([0xdf, 0xc4, 0x28, 0x5f]), { stream: false })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(42, 0, show(() => d.decode(new Uint8Array([0x0, 0x7e, 0x80, 0xfe, 0x2e]), { stream: false })));
  console.log(42, 1, show(() => d.decode(new Uint8Array([0xa]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(43, 0, show(() => d.decode(new Uint8Array([0x0, 0xa0, 0xe0]), { stream: true })));
  console.log(43, 1, show(() => d.decode(new Uint8Array([0x8e]), undefined)));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(44, 0, show(() => d.decode(new Uint8Array([0x30, 0xf, 0x7e, 0x8e]), { stream: true })));
  console.log(44, 1, show(() => d.decode(new Uint8Array([0x30]), { stream: false })));
  console.log(44, 2, show(() => d.decode(new Uint8Array([0x1b, 0x21, 0xbe, 0xd, 0xe0]), undefined)));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(45, 0, show(() => d.decode(new Uint8Array([0xb0, 0x8e, 0xa0, 0xa, 0xfd]), { stream: true })));
  console.log(45, 1, show(() => d.decode(new Uint8Array([0xff, 0xb0, 0x2e, 0x21]), { stream: true })));
  console.log(45, 2, show(() => d.decode(new Uint8Array([0x7e, 0xbe]))));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(46, 0, show(() => d.decode(new Uint8Array([0xc4, 0xff, 0xf0]), { stream: true })));
  console.log(46, 1, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(46, 2, show(() => d.decode(new Uint8Array([0xf0]))));
}
{
  const d = new TextDecoder("gb18030");
  console.log(47, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(47, 1, show(() => d.decode(new Uint8Array([0xfd, 0xff]), { stream: true })));
  console.log(47, 2, show(() => d.decode(new Uint8Array([0x1b, 0x21]))));
  console.log(47, 3, show(() => d.decode(new Uint8Array([0x7f, 0xa0, 0x5c, 0x5c, 0xd]), { stream: true })));
  console.log(47, 4, show(() => d.decode(new Uint8Array([0x8f, 0xff, 0x30, 0xdf, 0x3f]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(48, 0, show(() => d.decode(new Uint8Array([0x5c, 0xa1, 0xfc]), { stream: true })));
  console.log(48, 1, show(() => d.decode(new Uint8Array([0x5f, 0x1b]), { stream: true })));
}
{
  const d = new TextDecoder("gbk");
  console.log(49, 0, show(() => d.decode(new Uint8Array([0x8f]), { stream: false })));
  console.log(49, 1, show(() => d.decode(new Uint8Array([0x7f, 0x20]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(50, 0, show(() => d.decode(new Uint8Array([0xa1, 0x7e, 0xdf, 0xbe]), { stream: true })));
  console.log(50, 1, show(() => d.decode(new Uint8Array([0xb0, 0xbe, 0xa0]), undefined)));
  console.log(50, 2, show(() => d.decode(new Uint8Array([0x8e, 0xa, 0xe0, 0x39, 0x80]), { stream: false })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(51, 0, show(() => d.decode(new Uint8Array([0x41, 0x7b]))));
  console.log(51, 1, show(() => d.decode(new Uint8Array([0x2e]), { stream: false })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(52, 0, show(() => d.decode(new Uint8Array([0xfc, 0x5f, 0x3f, 0xe0]), { stream: false })));
  console.log(52, 1, show(() => d.decode(new Uint8Array([0xf0, 0xdf]), { stream: false })));
  console.log(52, 2, show(() => d.decode(new Uint8Array([0xb0, 0xa0]), { stream: true })));
  console.log(52, 3, show(() => d.decode(new Uint8Array([0x21]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(53, 0, show(() => d.decode(new Uint8Array([0x0]), { stream: false })));
  console.log(53, 1, show(() => d.decode(new Uint8Array([0xc4]))));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(54, 0, show(() => d.decode()));
  console.log(54, 1, show(() => d.decode(new Uint8Array([0x5f, 0x7e, 0xdf, 0x41]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(55, 0, show(() => d.decode(new Uint8Array([0xc4]), { stream: true })));
  console.log(55, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(55, 2, show(() => d.decode()));
}
{
  const d = new TextDecoder("gb18030");
  console.log(56, 0, show(() => d.decode(new Uint8Array([0x80, 0x8e]), { stream: true })));
  console.log(56, 1, show(() => d.decode(new Uint8Array([0xb0, 0x40]), undefined)));
  console.log(56, 2, show(() => d.decode(undefined, { stream: true })));
  console.log(56, 3, show(() => d.decode(new Uint8Array([0xff, 0xa1]))));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(57, 0, show(() => d.decode(new Uint8Array([0x1b, 0x7b, 0xff]), { stream: true })));
  console.log(57, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(57, 2, show(() => d.decode(new Uint8Array([0xfd, 0xe5, 0x5f]), { stream: true })));
  console.log(57, 3, show(() => d.decode(new Uint8Array([0xf, 0x21, 0xe5]), { stream: true })));
  console.log(57, 4, show(() => d.decode(new Uint8Array([0x5f, 0xe, 0xdf, 0xa0]), { stream: false })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(58, 0, show(() => d.decode(new Uint8Array([0x8f, 0x41, 0x39, 0x5f, 0x41]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(59, 0, show(() => d.decode(new Uint8Array([0xfe, 0xc4, 0x3f, 0xfe]), undefined)));
  console.log(59, 1, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(59, 2, show(() => d.decode(new Uint8Array([0x8e]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(60, 0, show(() => d.decode(new Uint8Array([0xf, 0x7b, 0xfe, 0x20]), { stream: true })));
  console.log(60, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(60, 2, show(() => d.decode(new Uint8Array([0x8e, 0x80, 0x41, 0x30]), { stream: false })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(61, 0, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(61, 1, show(() => d.decode(new Uint8Array([0x24]))));
  console.log(61, 2, show(() => d.decode(new Uint8Array([0x81, 0x2e, 0x5c]), { stream: true })));
  console.log(61, 3, show(() => d.decode(new Uint8Array([0xf, 0x28, 0x7f, 0x3f, 0x30]), undefined)));
}
{
  const d = new TextDecoder("gb18030");
  console.log(62, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(62, 1, show(() => d.decode(new Uint8Array([0xdf, 0x5f, 0xe]))));
}
{
  const d = new TextDecoder("gbk");
  console.log(63, 0, show(() => d.decode(new Uint8Array([0xa1, 0xa1, 0x0, 0x7f, 0x7f]))));
  console.log(63, 1, show(() => d.decode(new Uint8Array([0x39, 0x8e]), { stream: true })));
  console.log(63, 2, show(() => d.decode(new Uint8Array([0x7e, 0xfd, 0xdf, 0x20, 0x40]), undefined)));
  console.log(63, 3, show(() => d.decode(new Uint8Array([0x41, 0x20, 0xdf]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(64, 0, show(() => d.decode(new Uint8Array([0x40]), { stream: false })));
  console.log(64, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(64, 2, show(() => d.decode(new Uint8Array([0xa0, 0xe5, 0xc4]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(65, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(66, 0, show(() => d.decode(new Uint8Array([0x7e, 0x21]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(67, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(67, 1, show(() => d.decode(new Uint8Array([0xa, 0x9b, 0xbe, 0xfd, 0x81]))));
  console.log(67, 2, show(() => d.decode(new Uint8Array([]))));
  console.log(67, 3, show(() => d.decode(new Uint8Array([0x20, 0x40, 0x20, 0x39]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(68, 0, show(() => d.decode(new Uint8Array([0xc4, 0x2e, 0xf0, 0x39, 0xfe]), { stream: true })));
  console.log(68, 1, show(() => d.decode(new Uint8Array([0xa1]), { stream: true })));
  console.log(68, 2, show(() => d.decode(new Uint8Array([0xc4, 0x24]), { stream: true })));
  console.log(68, 3, show(() => d.decode(new Uint8Array([0xbe]), { stream: false })));
  console.log(68, 4, show(() => d.decode(new Uint8Array([0x0, 0x9f, 0x9f, 0xe5, 0xc4]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(69, 0, show(() => d.decode(new Uint8Array([0xfc]), { stream: true })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(70, 0, show(() => d.decode(new Uint8Array([0xa, 0xfd, 0x24]), { stream: true })));
}
{
  const d = new TextDecoder("gbk");
  console.log(71, 0, show(() => d.decode(new Uint8Array([0x7f, 0x8e, 0x20]), undefined)));
  console.log(71, 1, show(() => d.decode(new Uint8Array([0x7f, 0x41, 0x40, 0xdf, 0x28]), { stream: false })));
  console.log(71, 2, show(() => d.decode(new Uint8Array([]))));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(72, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(72, 1, show(() => d.decode(new Uint8Array([0xbe, 0x0, 0x21, 0x8e, 0x20]), { stream: true })));
  console.log(72, 2, show(() => d.decode(new Uint8Array([0x0, 0xa1]), undefined)));
  console.log(72, 3, show(() => d.decode(new Uint8Array([0xfd, 0xe0, 0xe, 0xd, 0xd]), { stream: false })));
  console.log(72, 4, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(73, 0, show(() => d.decode(new Uint8Array([0xbe]), { stream: true })));
  console.log(73, 1, show(() => d.decode(new Uint8Array([0xa, 0x21, 0xa1]), undefined)));
  console.log(73, 2, show(() => d.decode(new Uint8Array([]))));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(74, 0, show(() => d.decode(new Uint8Array([0xc4, 0x28]), { stream: true })));
}
{
  const d = new TextDecoder("gbk");
  console.log(75, 0, show(() => d.decode(new Uint8Array([0xff]), { stream: true })));
  console.log(75, 1, show(() => d.decode(new Uint8Array([0x8f, 0xf, 0xa1]), { stream: false })));
}
{
  const d = new TextDecoder("big5");
  console.log(76, 0, show(() => d.decode(new Uint8Array([0x20, 0x8f, 0x81, 0x9f]), undefined)));
  console.log(76, 1, show(() => d.decode(new Uint8Array([0x21, 0xfd, 0x9b]), undefined)));
  console.log(76, 2, show(() => d.decode(new Uint8Array([0x1b, 0x20]), undefined)));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(77, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(77, 1, show(() => d.decode(new Uint8Array([0x24]), { stream: false })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(78, 0, show(() => d.decode(new Uint8Array([0x30, 0x21]), { stream: true })));
}
{
  const d = new TextDecoder("gbk");
  console.log(79, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(79, 1, show(() => d.decode(new Uint8Array([0x41]))));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(80, 0, show(() => d.decode(new Uint8Array([0x39, 0xa, 0x41, 0xa]), { stream: false })));
  console.log(80, 1, show(() => d.decode(new Uint8Array([0x81, 0xbe, 0xdf]), { stream: true })));
  console.log(80, 2, show(() => d.decode(new Uint8Array([0x5f, 0x9f, 0xd, 0xdf, 0xfd]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(81, 0, show(() => d.decode(new Uint8Array([0x39, 0x5f, 0x39]))));
  console.log(81, 1, show(() => d.decode(new Uint8Array([0xfc, 0x9b, 0xfe]), { stream: true })));
  console.log(81, 2, show(() => d.decode(new Uint8Array([0xe5, 0xfc]), { stream: true })));
  console.log(81, 3, show(() => d.decode(new Uint8Array([0xa, 0x24, 0x28, 0xb0, 0x28]), undefined)));
  console.log(81, 4, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(82, 0, show(() => d.decode(new Uint8Array([0x41]))));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(83, 0, show(() => d.decode(new Uint8Array([0x2e, 0x40, 0xbe, 0xff]), undefined)));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(84, 0, show(() => d.decode(new Uint8Array([0x21, 0xff, 0xfc, 0xb0]))));
  console.log(84, 1, show(() => d.decode(new Uint8Array([0x1b, 0xfe, 0xdf, 0xdf]), { stream: true })));
  console.log(84, 2, show(() => d.decode(new Uint8Array([]))));
  console.log(84, 3, show(() => d.decode(new Uint8Array([0xa, 0x3f, 0x7e]), undefined)));
  console.log(84, 4, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(85, 0, show(() => d.decode(new Uint8Array([0xd, 0xa1, 0x9f]), { stream: true })));
  console.log(85, 1, show(() => d.decode(new Uint8Array([0xe0]), { stream: false })));
  console.log(85, 2, show(() => d.decode(new Uint8Array([0x30, 0x1b]), undefined)));
  console.log(85, 3, show(() => d.decode(new Uint8Array([0x7e, 0x39, 0x21]), { stream: true })));
  console.log(85, 4, show(() => d.decode(new Uint8Array([0x41, 0xe5]), undefined)));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(86, 0, show(() => d.decode(new Uint8Array([0xb0, 0x7b, 0x2e, 0x2e]), { stream: true })));
  console.log(86, 1, show(() => d.decode(undefined, { stream: true })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(87, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(87, 1, show(() => d.decode(new Uint8Array([]))));
  console.log(87, 2, show(() => d.decode(new Uint8Array([0x8f]), { stream: true })));
  console.log(87, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(87, 4, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(88, 0, show(() => d.decode(new Uint8Array([0xa0, 0xa1]), { stream: true })));
  console.log(88, 1, show(() => d.decode(new Uint8Array([0x20, 0x30, 0x39]), { stream: true })));
}
{
  const d = new TextDecoder("gbk");
  console.log(89, 0, show(() => d.decode(new Uint8Array([0x80]), { stream: true })));
  console.log(89, 1, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(89, 2, show(() => d.decode(new Uint8Array([0xf, 0xe5, 0xa0, 0xfd, 0xf0]), { stream: false })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(90, 0, show(() => d.decode(new Uint8Array([0x39, 0x20]))));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(91, 0, show(() => d.decode(new Uint8Array([0x24, 0x30, 0x7f]), { stream: true })));
  console.log(91, 1, show(() => d.decode(new Uint8Array([0xa0, 0x28, 0xb0, 0x5c, 0x39]), undefined)));
  console.log(91, 2, show(() => d.decode(new Uint8Array([0x0, 0x41, 0x5f]), { stream: true })));
  console.log(91, 3, show(() => d.decode(new Uint8Array([0xa0]), { stream: true })));
  console.log(91, 4, show(() => d.decode(new Uint8Array([0xd, 0x2e, 0x5c, 0xb0, 0xa0]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(92, 0, show(() => d.decode(new Uint8Array([0x7b]), undefined)));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(93, 0, show(() => d.decode(new Uint8Array([0xa, 0xdf, 0xf0, 0x24, 0xbe]), { stream: true })));
  console.log(93, 1, show(() => d.decode(new Uint8Array([0x41, 0x80, 0x30]), { stream: false })));
  console.log(93, 2, show(() => d.decode(new Uint8Array([]))));
  console.log(93, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(93, 4, show(() => d.decode(new Uint8Array([0x2e, 0xc4, 0x40]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(94, 0, show(() => d.decode(new Uint8Array([0xe]), { stream: false })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(95, 0, show(() => d.decode(new Uint8Array([0x3f, 0xf0, 0xff, 0x21, 0xdf]), undefined)));
  console.log(95, 1, show(() => d.decode(new Uint8Array([0x0]), { stream: false })));
  console.log(95, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(95, 3, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(96, 0, show(() => d.decode(undefined, { stream: true })));
  console.log(96, 1, show(() => d.decode(new Uint8Array([0x8f, 0x24, 0xbe, 0xa, 0xfe]), { stream: true })));
}
{
  const d = new TextDecoder("gbk");
  console.log(97, 0, show(() => d.decode(new Uint8Array([0xdf]), { stream: false })));
  console.log(97, 1, show(() => d.decode(new Uint8Array([0xfc]), undefined)));
  console.log(97, 2, show(() => d.decode(new Uint8Array([0xf]))));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(98, 0, show(() => d.decode(new Uint8Array([0xc4, 0xa1, 0xfd, 0xfd, 0xa0]), { stream: true })));
  console.log(98, 1, show(() => d.decode(undefined, { stream: false })));
  console.log(98, 2, show(() => d.decode(new Uint8Array([0xb0]), undefined)));
  console.log(98, 3, show(() => d.decode(new Uint8Array([0xfe, 0x21, 0xa0, 0xe0]), { stream: false })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(99, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(100, 0, show(() => d.decode(new Uint8Array([0xf0, 0x5f, 0x9f, 0x39, 0xfd]), { stream: false })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(101, 0, show(() => d.decode(new Uint8Array([0xa, 0xfd, 0xe0, 0x80]))));
}
{
  const d = new TextDecoder("big5");
  console.log(102, 0, show(() => d.decode(new Uint8Array([0x8e, 0x9f, 0xe5, 0x30]), { stream: false })));
  console.log(102, 1, show(() => d.decode(new Uint8Array([0xff, 0x2e, 0xa]), { stream: true })));
  console.log(102, 2, show(() => d.decode(new Uint8Array([0xfe]), { stream: true })));
  console.log(102, 3, show(() => d.decode(new Uint8Array([0x7e, 0x1b, 0xe5]))));
  console.log(102, 4, show(() => d.decode(new Uint8Array([0x81, 0x40, 0xf, 0xff]))));
}
{
  const d = new TextDecoder("gb18030");
  console.log(103, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(103, 1, show(() => d.decode(new Uint8Array([0xdf, 0x1b]), { stream: true })));
  console.log(103, 2, show(() => d.decode(new Uint8Array([0x7e, 0xe5]), { stream: true })));
  console.log(103, 3, show(() => d.decode(new Uint8Array([0xe5, 0x40, 0xff, 0xfd, 0xfc]), { stream: false })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(104, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(104, 1, show(() => d.decode(new Uint8Array([0xf, 0x8f, 0xe5, 0x41]))));
  console.log(104, 2, show(() => d.decode(new Uint8Array([0x21, 0x9b, 0x20, 0x28]), undefined)));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(105, 0, show(() => d.decode(new Uint8Array([0xa, 0x8e, 0xf, 0x7e]), { stream: true })));
  console.log(105, 1, show(() => d.decode(new Uint8Array([0x9f, 0x7b]), { stream: true })));
}
{
  const d = new TextDecoder("gbk");
  console.log(106, 0, show(() => d.decode(new Uint8Array([0xdf]), { stream: true })));
  console.log(106, 1, show(() => d.decode(new Uint8Array([0x40, 0xfe, 0x0, 0x7b]), { stream: false })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(107, 0, show(() => d.decode(new Uint8Array([]), undefined)));
}
{
  const d = new TextDecoder("big5");
  console.log(108, 0, show(() => d.decode(new Uint8Array([0x20, 0xb0, 0x40, 0x20]))));
  console.log(108, 1, show(() => d.decode(new Uint8Array([]), undefined)));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(109, 0, show(() => d.decode(new Uint8Array([0xe0]))));
  console.log(109, 1, show(() => d.decode(new Uint8Array([0xe5, 0x20, 0xf, 0xe5, 0x8e]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(110, 0, show(() => d.decode(new Uint8Array([0x28, 0x8e]), undefined)));
  console.log(110, 1, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(110, 2, show(() => d.decode(new Uint8Array([0xbe, 0x8e, 0xf, 0x24, 0xc4]))));
  console.log(110, 3, show(() => d.decode(new Uint8Array([0xfd, 0xfe, 0x5f, 0x20]), { stream: false })));
}
{
  const d = new TextDecoder("big5");
  console.log(111, 0, show(() => d.decode(new Uint8Array([0x7f, 0xc4, 0xa, 0xfc, 0xc4]), undefined)));
  console.log(111, 1, show(() => d.decode(new Uint8Array([0x1b]), { stream: true })));
}
{
  const d = new TextDecoder("big5");
  console.log(112, 0, show(() => d.decode(new Uint8Array([0x5c, 0xf, 0x30, 0xa1]), { stream: true })));
  console.log(112, 1, show(() => d.decode(new Uint8Array([0xa1, 0x2e, 0xbe, 0xc4, 0x7f]), { stream: true })));
  console.log(112, 2, show(() => d.decode(new Uint8Array([0x7f, 0xd]), { stream: false })));
  console.log(112, 3, show(() => d.decode(new Uint8Array([0xdf, 0x9f]))));
}
{
  const d = new TextDecoder("gbk");
  console.log(113, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(114, 0, show(() => d.decode(new Uint8Array([0xfe, 0x3f]), { stream: true })));
  console.log(114, 1, show(() => d.decode(new Uint8Array([0x80, 0x8f]), { stream: true })));
  console.log(114, 2, show(() => d.decode(new Uint8Array([0xfd, 0x8e]), undefined)));
  console.log(114, 3, show(() => d.decode(new Uint8Array([0x41, 0xc4, 0xff]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(115, 0, show(() => d.decode(new Uint8Array([0xfc, 0x5c]), { stream: true })));
  console.log(115, 1, show(() => d.decode(new Uint8Array([0xa, 0xbe, 0xdf, 0x2e, 0x24]), undefined)));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(116, 0, show(() => d.decode(new Uint8Array([0xa0, 0xdf]))));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(117, 0, show(() => d.decode(new Uint8Array([0x39]), { stream: true })));
  console.log(117, 1, show(() => d.decode(new Uint8Array([0x40, 0xe0, 0x40, 0x8f, 0xa0]), undefined)));
  console.log(117, 2, show(() => d.decode(new Uint8Array([0x8f, 0x2e, 0xfe]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(118, 0, show(() => d.decode(new Uint8Array([0xb0, 0xe5, 0x8f, 0xf0, 0xfd]), undefined)));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(119, 0, show(() => d.decode()));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(120, 0, show(() => d.decode(new Uint8Array([0x24, 0xa0, 0xfd, 0xfc, 0xe0]), { stream: true })));
  console.log(120, 1, show(() => d.decode(new Uint8Array([0xfd, 0xa0, 0x39, 0x9b]), undefined)));
  console.log(120, 2, show(() => d.decode(new Uint8Array([0xfd]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(121, 0, show(() => d.decode(new Uint8Array([0x20, 0xe0, 0x9f, 0xe]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(122, 0, show(() => d.decode(new Uint8Array([0x8f, 0x7b, 0x8f, 0x5f, 0x3f]), { stream: true })));
  console.log(122, 1, show(() => d.decode(new Uint8Array([0xff]), { stream: true })));
  console.log(122, 2, show(() => d.decode(new Uint8Array([0xa1]))));
  console.log(122, 3, show(() => d.decode(new Uint8Array([0x7b, 0x0, 0xd]), undefined)));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(123, 0, show(() => d.decode(new Uint8Array([0x20, 0x39, 0xf, 0xdf, 0x0]), { stream: true })));
  console.log(123, 1, show(() => d.decode(new Uint8Array([0xe, 0xfe, 0xf0, 0xc4]), { stream: false })));
  console.log(123, 2, show(() => d.decode(new Uint8Array([0xdf, 0xb0]), { stream: true })));
  console.log(123, 3, show(() => d.decode(new Uint8Array([0xdf, 0x8e, 0x81, 0x1b]), { stream: true })));
  console.log(123, 4, show(() => d.decode(new Uint8Array([0x8e, 0x7f, 0xdf]), undefined)));
}
{
  const d = new TextDecoder("big5");
  console.log(124, 0, show(() => d.decode(new Uint8Array([0xf0, 0x2e]), { stream: true })));
  console.log(124, 1, show(() => d.decode(new Uint8Array([0xdf, 0x80, 0xa, 0x7e, 0x24]))));
  console.log(124, 2, show(() => d.decode(new Uint8Array([0x7e, 0x1b, 0x24]), undefined)));
  console.log(124, 3, show(() => d.decode(new Uint8Array([0x39]), undefined)));
  console.log(124, 4, show(() => d.decode(new Uint8Array([0xe0, 0xfc, 0x0, 0x81, 0x41]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(125, 0, show(() => d.decode(new Uint8Array([0xfd, 0x30, 0xbe]), undefined)));
  console.log(125, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(125, 2, show(() => d.decode(new Uint8Array([0x20]), { stream: true })));
  console.log(125, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(125, 4, show(() => d.decode(new Uint8Array([0x9f, 0xdf, 0x81, 0xff]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(126, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(126, 1, show(() => d.decode(new Uint8Array([0x7f]), undefined)));
  console.log(126, 2, show(() => d.decode(new Uint8Array([0xff, 0xfe, 0x20]), { stream: false })));
  console.log(126, 3, show(() => d.decode(undefined, { stream: false })));
  console.log(126, 4, show(() => d.decode(new Uint8Array([0x0]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(127, 0, show(() => d.decode(new Uint8Array([0xf]), undefined)));
  console.log(127, 1, show(() => d.decode(new Uint8Array([0x39, 0x80, 0x7b]))));
  console.log(127, 2, show(() => d.decode(new Uint8Array([0xe5]), { stream: true })));
  console.log(127, 3, show(() => d.decode(new Uint8Array([0xb0, 0xff, 0x41]))));
  console.log(127, 4, show(() => d.decode(new Uint8Array([0xbe, 0x8e, 0xa1]))));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(128, 0, show(() => d.decode(new Uint8Array([0xff, 0xdf, 0xa1, 0x9f, 0xbe]), { stream: true })));
  console.log(128, 1, show(() => d.decode(new Uint8Array([0xa1]), { stream: false })));
  console.log(128, 2, show(() => d.decode(undefined, { stream: false })));
  console.log(128, 3, show(() => d.decode(new Uint8Array([0xff, 0xb0]), undefined)));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(129, 0, show(() => d.decode(new Uint8Array([0xfd]), { stream: true })));
  console.log(129, 1, show(() => d.decode(new Uint8Array([0xc4, 0x8f, 0x20]))));
  console.log(129, 2, show(() => d.decode(new Uint8Array([0xe0, 0xa0]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(130, 0, show(() => d.decode(new Uint8Array([0x7e, 0x9b, 0xe, 0xe0, 0xbe]))));
  console.log(130, 1, show(() => d.decode(new Uint8Array([0xa, 0x40]), { stream: false })));
  console.log(130, 2, show(() => d.decode(new Uint8Array([0x5c, 0xf]), undefined)));
  console.log(130, 3, show(() => d.decode(new Uint8Array([0xa0, 0x0, 0xf0, 0xf, 0xff]), { stream: true })));
  console.log(130, 4, show(() => d.decode(new Uint8Array([0xfd, 0x7e, 0xbe, 0x20, 0x5c]), { stream: true })));
}
{
  const d = new TextDecoder("gbk");
  console.log(131, 0, show(() => d.decode(new Uint8Array([0xa0, 0x30, 0x80]))));
  console.log(131, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(131, 2, show(() => d.decode(new Uint8Array([0xff, 0x9b, 0x7f]), { stream: false })));
  console.log(131, 3, show(() => d.decode(new Uint8Array([0xfe, 0xdf]), { stream: true })));
  console.log(131, 4, show(() => d.decode(new Uint8Array([0x81, 0x80]), undefined)));
}
{
  const d = new TextDecoder("gbk");
  console.log(132, 0, show(() => d.decode(new Uint8Array([0xdf, 0x1b, 0xdf]))));
}
{
  const d = new TextDecoder("big5");
  console.log(133, 0, show(() => d.decode(new Uint8Array([0x3f, 0xff, 0x20, 0x9f, 0x24]), { stream: true })));
  console.log(133, 1, show(() => d.decode(new Uint8Array([0xa1, 0x7b, 0x80, 0x7e]), undefined)));
  console.log(133, 2, show(() => d.decode(new Uint8Array([0xbe, 0x21, 0xe0, 0xfc, 0xe5]), undefined)));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(134, 0, show(() => d.decode(new Uint8Array([0x3f, 0x39]), { stream: true })));
  console.log(134, 1, show(() => d.decode(new Uint8Array([0x2e]), { stream: true })));
  console.log(134, 2, show(() => d.decode(new Uint8Array([0xd]), { stream: true })));
  console.log(134, 3, show(() => d.decode(undefined, undefined)));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(135, 0, show(() => d.decode(new Uint8Array([0x80, 0x7f, 0xf0, 0x7e]))));
  console.log(135, 1, show(() => d.decode(new Uint8Array([0x3f, 0xa0, 0x8f, 0x0]), { stream: true })));
  console.log(135, 2, show(() => d.decode(new Uint8Array([0x41, 0x2e]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(136, 0, show(() => d.decode(new Uint8Array([0xfc, 0x30]), { stream: true })));
  console.log(136, 1, show(() => d.decode(new Uint8Array([0x28, 0xfc]))));
  console.log(136, 2, show(() => d.decode(new Uint8Array([0xfc, 0x21]), { stream: true })));
  console.log(136, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(137, 0, show(() => d.decode(new Uint8Array([0x81, 0xe, 0xa1, 0x9f]))));
  console.log(137, 1, show(() => d.decode(new Uint8Array([0xb0, 0x39, 0x40, 0xfd, 0x28]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(138, 0, show(() => d.decode(new Uint8Array([0x3f]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(139, 0, show(() => d.decode(new Uint8Array([]))));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(140, 0, show(() => d.decode(new Uint8Array([0xdf]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(141, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(141, 1, show(() => d.decode(new Uint8Array([0xc4, 0xe0]))));
  console.log(141, 2, show(() => d.decode(new Uint8Array([0xa]), { stream: true })));
  console.log(141, 3, show(() => d.decode(new Uint8Array([0x9f]), { stream: true })));
  console.log(141, 4, show(() => d.decode(new Uint8Array([0xa0, 0x80, 0x28]), { stream: false })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(142, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(142, 1, show(() => d.decode(new Uint8Array([0xfd, 0xf0, 0x7e, 0x9b, 0x21]), { stream: true })));
  console.log(142, 2, show(() => d.decode(new Uint8Array([]))));
  console.log(142, 3, show(() => d.decode(new Uint8Array([0xfe, 0xa0, 0x28]), undefined)));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(143, 0, show(() => d.decode(new Uint8Array([0x24, 0xa0, 0xfd]), { stream: true })));
  console.log(143, 1, show(() => d.decode(undefined, { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(144, 0, show(() => d.decode(new Uint8Array([0x7f]), undefined)));
}
{
  const d = new TextDecoder("gb18030");
  console.log(145, 0, show(() => d.decode(new Uint8Array([0x7e, 0xff, 0xe0, 0x7f, 0xa]), undefined)));
  console.log(145, 1, show(() => d.decode(undefined, { stream: false })));
  console.log(145, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(145, 3, show(() => d.decode(new Uint8Array([]))));
  console.log(145, 4, show(() => d.decode(new Uint8Array([0xbe, 0x0, 0xfd, 0xa1]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(146, 0, show(() => d.decode(new Uint8Array([0xdf, 0xe5, 0xf]), { stream: true })));
  console.log(146, 1, show(() => d.decode(new Uint8Array([0x7b, 0xbe]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(147, 0, show(() => d.decode(new Uint8Array([0x24, 0x21, 0xfc, 0x7f, 0x3f]), undefined)));
  console.log(147, 1, show(() => d.decode(new Uint8Array([0x9f, 0x39, 0xff]), undefined)));
  console.log(147, 2, show(() => d.decode(undefined, { stream: true })));
  console.log(147, 3, show(() => d.decode(new Uint8Array([0xe5, 0x20, 0x30]), { stream: true })));
  console.log(147, 4, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(148, 0, show(() => d.decode(new Uint8Array([0x7e, 0x39]), undefined)));
  console.log(148, 1, show(() => d.decode(new Uint8Array([0xe5, 0xa0, 0xa0, 0xc4, 0x3f]), { stream: true })));
  console.log(148, 2, show(() => d.decode(undefined, { stream: true })));
  console.log(148, 3, show(() => d.decode(new Uint8Array([0x9f, 0x7b, 0x9b, 0x39]), undefined)));
  console.log(148, 4, show(() => d.decode(new Uint8Array([0x2e, 0xdf, 0xf, 0x21, 0xe]), undefined)));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(149, 0, show(() => d.decode(new Uint8Array([0x5c, 0x1b, 0xa0, 0x5f, 0xf]), { stream: true })));
  console.log(149, 1, show(() => d.decode(new Uint8Array([0x21, 0xb0, 0x5f, 0xe]), undefined)));
  console.log(149, 2, show(() => d.decode(new Uint8Array([0x28]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(150, 0, show(() => d.decode(new Uint8Array([0x40, 0xb0]), { stream: true })));
  console.log(150, 1, show(() => d.decode(new Uint8Array([0x24, 0x40, 0x5c]), { stream: true })));
  console.log(150, 2, show(() => d.decode(new Uint8Array([0x9b, 0x0]), undefined)));
  console.log(150, 3, show(() => d.decode(new Uint8Array([0x7f, 0x7f, 0x30]), { stream: true })));
  console.log(150, 4, show(() => d.decode(new Uint8Array([0x7e, 0xa, 0x2e, 0x9f, 0x9f]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(151, 0, show(() => d.decode(new Uint8Array([0x39, 0x5c]), { stream: true })));
  console.log(151, 1, show(() => d.decode(new Uint8Array([0xfe]), { stream: true })));
  console.log(151, 2, show(() => d.decode(new Uint8Array([0xc4, 0x39]), undefined)));
  console.log(151, 3, show(() => d.decode(undefined, undefined)));
}
{
  const d = new TextDecoder("gbk");
  console.log(152, 0, show(() => d.decode(new Uint8Array([0xf0]), undefined)));
  console.log(152, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(152, 2, show(() => d.decode(new Uint8Array([0x28, 0x41, 0x3f]), { stream: true })));
  console.log(152, 3, show(() => d.decode(new Uint8Array([0xbe]), { stream: true })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(153, 0, show(() => d.decode(new Uint8Array([0x20, 0x8f]), { stream: false })));
  console.log(153, 1, show(() => d.decode(undefined, undefined)));
  console.log(153, 2, show(() => d.decode(new Uint8Array([0x5f, 0x8e, 0xc4]), undefined)));
  console.log(153, 3, show(() => d.decode(new Uint8Array([]))));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(154, 0, show(() => d.decode(new Uint8Array([0x81, 0x5c]))));
  console.log(154, 1, show(() => d.decode(new Uint8Array([0x1b, 0x1b, 0x5c]), undefined)));
  console.log(154, 2, show(() => d.decode(new Uint8Array([0xb0]), { stream: true })));
  console.log(154, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(155, 0, show(() => d.decode(new Uint8Array([0xa0]), undefined)));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(156, 0, show(() => d.decode(new Uint8Array([0x8e]), { stream: true })));
  console.log(156, 1, show(() => d.decode(new Uint8Array([0x7b, 0x30]), undefined)));
  console.log(156, 2, show(() => d.decode(new Uint8Array([0x8f, 0x2e]), { stream: true })));
  console.log(156, 3, show(() => d.decode(new Uint8Array([0xfd, 0xe0, 0x28, 0x9b, 0x9f]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(157, 0, show(() => d.decode(new Uint8Array([0x39]), { stream: true })));
  console.log(157, 1, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(157, 2, show(() => d.decode(undefined, { stream: true })));
  console.log(157, 3, show(() => d.decode(new Uint8Array([0xff, 0x24, 0x41]), { stream: true })));
  console.log(157, 4, show(() => d.decode(new Uint8Array([]), undefined)));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(158, 0, show(() => d.decode(new Uint8Array([0x5f, 0x9f, 0xdf]), undefined)));
  console.log(158, 1, show(() => d.decode(new Uint8Array([0xa0, 0xdf, 0xd, 0x81]), { stream: false })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(159, 0, show(() => d.decode(new Uint8Array([0xdf]))));
  console.log(159, 1, show(() => d.decode(new Uint8Array([0xdf, 0x0, 0xd, 0x5f, 0x24]))));
  console.log(159, 2, show(() => d.decode(new Uint8Array([0xa]), { stream: true })));
  console.log(159, 3, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(159, 4, show(() => d.decode(new Uint8Array([0x20, 0xfe]))));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(160, 0, show(() => d.decode(new Uint8Array([]))));
  console.log(160, 1, show(() => d.decode(new Uint8Array([0xdf, 0xbe, 0x7e]))));
  console.log(160, 2, show(() => d.decode(new Uint8Array([0xe5]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(161, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(161, 1, show(() => d.decode(new Uint8Array([0x7b, 0xe5]), undefined)));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(162, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(163, 0, show(() => d.decode(new Uint8Array([0xe5, 0xff, 0x24]), { stream: true })));
  console.log(163, 1, show(() => d.decode(new Uint8Array([0x39, 0x24, 0xa]), { stream: false })));
  console.log(163, 2, show(() => d.decode(new Uint8Array([0xa1, 0x24, 0xc4, 0x7f, 0x7f]), { stream: true })));
}
{
  const d = new TextDecoder("big5");
  console.log(164, 0, show(() => d.decode(new Uint8Array([0x39, 0xfe, 0x40, 0xc4, 0xfe]), { stream: true })));
  console.log(164, 1, show(() => d.decode(new Uint8Array([0x2e, 0x39, 0xfe, 0xf0, 0x8f]), { stream: true })));
  console.log(164, 2, show(() => d.decode(new Uint8Array([0xfd]), { stream: false })));
  console.log(164, 3, show(() => d.decode(new Uint8Array([0xf, 0x41, 0x28, 0x21, 0x2e]), { stream: false })));
  console.log(164, 4, show(() => d.decode(new Uint8Array([0x8f, 0xf, 0x21, 0x2e, 0xdf]), { stream: true })));
}
{
  const d = new TextDecoder("gbk");
  console.log(165, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(166, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(166, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(166, 2, show(() => d.decode(new Uint8Array([0x1b, 0xff, 0xdf]), undefined)));
  console.log(166, 3, show(() => d.decode(new Uint8Array([0x2e]), { stream: true })));
  console.log(166, 4, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(167, 0, show(() => d.decode(undefined, { stream: true })));
  console.log(167, 1, show(() => d.decode(new Uint8Array([0xe0, 0xb0, 0x24]), { stream: true })));
  console.log(167, 2, show(() => d.decode(new Uint8Array([0xf, 0x81, 0x3f]), { stream: true })));
  console.log(167, 3, show(() => d.decode(new Uint8Array([0xe0, 0x7f]), undefined)));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(168, 0, show(() => d.decode(new Uint8Array([0xa]), { stream: true })));
  console.log(168, 1, show(() => d.decode(new Uint8Array([0xa0, 0x80]))));
  console.log(168, 2, show(() => d.decode(new Uint8Array([0x30, 0x24, 0xf0, 0xe5, 0xa1]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(169, 0, show(() => d.decode(new Uint8Array([0x28, 0x80, 0x1b]))));
  console.log(169, 1, show(() => d.decode(new Uint8Array([0xdf, 0x5c, 0x9f]), { stream: true })));
  console.log(169, 2, show(() => d.decode(new Uint8Array([0x5f, 0x30]), { stream: false })));
  console.log(169, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(169, 4, show(() => d.decode(new Uint8Array([0xa0, 0x21, 0x28, 0x0, 0xff]))));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(170, 0, show(() => d.decode(new Uint8Array([]))));
  console.log(170, 1, show(() => d.decode(new Uint8Array([0x9b, 0xbe, 0x2e, 0x7e, 0x81]), undefined)));
  console.log(170, 2, show(() => d.decode(new Uint8Array([0x41, 0xe5, 0xf0]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(171, 0, show(() => d.decode(new Uint8Array([0xb0, 0x41, 0x5f]))));
  console.log(171, 1, show(() => d.decode(new Uint8Array([0xfd]), { stream: false })));
  console.log(171, 2, show(() => d.decode(new Uint8Array([0x7f, 0xfc, 0x3f, 0xe]), { stream: true })));
  console.log(171, 3, show(() => d.decode(new Uint8Array([0x41, 0xdf, 0xfc, 0xbe, 0xc4]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(172, 0, show(() => d.decode(new Uint8Array([0x2e, 0xa0]), { stream: false })));
  console.log(172, 1, show(() => d.decode(new Uint8Array([0x40, 0xa0, 0x21]), { stream: true })));
  console.log(172, 2, show(() => d.decode(new Uint8Array([0x30, 0x9b, 0x7f, 0x39, 0xa1]), { stream: true })));
  console.log(172, 3, show(() => d.decode(new Uint8Array([0x2e, 0xa1, 0xf, 0x0, 0x7e]), { stream: false })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(173, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(173, 1, show(() => d.decode(new Uint8Array([0xf, 0x28]), undefined)));
  console.log(173, 2, show(() => d.decode(new Uint8Array([0x80, 0xa, 0xff]), undefined)));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(174, 0, show(() => d.decode(new Uint8Array([0x1b, 0xe]), undefined)));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(175, 0, show(() => d.decode(new Uint8Array([0x39, 0xc4]), undefined)));
  console.log(175, 1, show(() => d.decode(new Uint8Array([0xa0, 0x24]), { stream: true })));
  console.log(175, 2, show(() => d.decode(new Uint8Array([0x28, 0x2e, 0x40]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(176, 0, show(() => d.decode(new Uint8Array([0x20, 0x2e, 0x39, 0x5c, 0xdf]), { stream: true })));
  console.log(176, 1, show(() => d.decode(new Uint8Array([0x7b, 0x40, 0xa, 0xa1, 0x3f]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(177, 0, show(() => d.decode(new Uint8Array([0xf]), { stream: true })));
  console.log(177, 1, show(() => d.decode(new Uint8Array([]), undefined)));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(178, 0, show(() => d.decode(undefined, { stream: false })));
  console.log(178, 1, show(() => d.decode(new Uint8Array([0x40]), { stream: true })));
  console.log(178, 2, show(() => d.decode()));
  console.log(178, 3, show(() => d.decode(new Uint8Array([0xe0, 0x0, 0xe, 0x40, 0xfe]), { stream: false })));
  console.log(178, 4, show(() => d.decode(new Uint8Array([0xc4, 0x2e, 0x5f, 0xc4]), { stream: false })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(179, 0, show(() => d.decode(new Uint8Array([0xdf, 0xb0, 0x28]))));
  console.log(179, 1, show(() => d.decode(new Uint8Array([0xb0]), { stream: true })));
  console.log(179, 2, show(() => d.decode(new Uint8Array([0x21, 0x7e, 0x80, 0xa]), { stream: true })));
  console.log(179, 3, show(() => d.decode(new Uint8Array([0x80, 0xe0]), { stream: false })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(180, 0, show(() => d.decode(new Uint8Array([0x2e]), undefined)));
  console.log(180, 1, show(() => d.decode(new Uint8Array([0xbe]), { stream: true })));
  console.log(180, 2, show(() => d.decode(new Uint8Array([0x20, 0x24]), undefined)));
}
{
  const d = new TextDecoder("big5");
  console.log(181, 0, show(() => d.decode(new Uint8Array([0x0, 0x81, 0x30, 0x9b]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(182, 0, show(() => d.decode(new Uint8Array([0xfe, 0x2e, 0xbe, 0xbe, 0x5c]))));
  console.log(182, 1, show(() => d.decode(new Uint8Array([0xfe, 0xe0, 0xdf, 0xa1, 0x7e]), { stream: true })));
  console.log(182, 2, show(() => d.decode(new Uint8Array([0x20, 0xff, 0x39, 0xff, 0x5c]), { stream: true })));
  console.log(182, 3, show(() => d.decode(new Uint8Array([0xa, 0xff, 0x5f]), { stream: false })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(183, 0, show(() => d.decode(new Uint8Array([0xfe, 0x80]), { stream: true })));
  console.log(183, 1, show(() => d.decode(new Uint8Array([0x24, 0xa, 0x21, 0x20]), { stream: true })));
  console.log(183, 2, show(() => d.decode()));
  console.log(183, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(183, 4, show(() => d.decode(new Uint8Array([0x40, 0xb0, 0x9f, 0x7b, 0x7b]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(184, 0, show(() => d.decode(new Uint8Array([0x7f, 0xfc, 0xf0, 0xdf, 0x28]), { stream: true })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(185, 0, show(() => d.decode(new Uint8Array([0x7e, 0x1b, 0x0]), { stream: true })));
  console.log(185, 1, show(() => d.decode(new Uint8Array([0x28, 0x7f, 0x30, 0xe, 0x40]), undefined)));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(186, 0, show(() => d.decode(undefined, { stream: true })));
  console.log(186, 1, show(() => d.decode(new Uint8Array([0x80]), { stream: true })));
  console.log(186, 2, show(() => d.decode(new Uint8Array([0xb0]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(187, 0, show(() => d.decode(new Uint8Array([0x20]), { stream: true })));
  console.log(187, 1, show(() => d.decode(new Uint8Array([0xa]), undefined)));
}
{
  const d = new TextDecoder("gb18030");
  console.log(188, 0, show(() => d.decode(new Uint8Array([0xc4, 0x5f, 0x1b, 0xf0, 0xc4]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(189, 0, show(() => d.decode(new Uint8Array([0x1b, 0x20]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(190, 0, show(() => d.decode(new Uint8Array([0xa, 0x9b, 0xa0, 0xe5, 0x7b]), undefined)));
  console.log(190, 1, show(() => d.decode(new Uint8Array([0x7f]), { stream: true })));
  console.log(190, 2, show(() => d.decode(new Uint8Array([0xf0, 0xf0]), { stream: true })));
  console.log(190, 3, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("gbk");
  console.log(191, 0, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(191, 1, show(() => d.decode(new Uint8Array([0xa1, 0xbe, 0x9b, 0xff, 0x3f]), { stream: false })));
  console.log(191, 2, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(191, 3, show(() => d.decode(new Uint8Array([0xe0, 0x5f, 0x7e, 0xa0]), undefined)));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(192, 0, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(192, 1, show(() => d.decode(new Uint8Array([0xd, 0xa1, 0xfe]), undefined)));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(193, 0, show(() => d.decode(new Uint8Array([0x81, 0xc4, 0x0, 0x39]), { stream: true })));
  console.log(193, 1, show(() => d.decode(new Uint8Array([0x1b]), { stream: true })));
  console.log(193, 2, show(() => d.decode(new Uint8Array([0xe, 0x80]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(194, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(194, 1, show(() => d.decode(new Uint8Array([0x7e, 0xe, 0x7f, 0xdf, 0xfd]), { stream: false })));
  console.log(194, 2, show(() => d.decode(new Uint8Array([0xa0]), { stream: true })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(195, 0, show(() => d.decode(new Uint8Array([0x1b]), { stream: true })));
  console.log(195, 1, show(() => d.decode(new Uint8Array([0x0, 0x80]), undefined)));
  console.log(195, 2, show(() => d.decode(new Uint8Array([0xff]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(196, 0, show(() => d.decode(new Uint8Array([0xa0, 0xbe, 0xfc, 0x5c]))));
  console.log(196, 1, show(() => d.decode(new Uint8Array([0xfd]), { stream: true })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(197, 0, show(() => d.decode(new Uint8Array([0xf0]), undefined)));
  console.log(197, 1, show(() => d.decode(new Uint8Array([0xdf]), { stream: false })));
  console.log(197, 2, show(() => d.decode(new Uint8Array([0x9f, 0x41, 0xf]), undefined)));
  console.log(197, 3, show(() => d.decode(new Uint8Array([0x5f, 0x2e]), { stream: true })));
  console.log(197, 4, show(() => d.decode(undefined, undefined)));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(198, 0, show(() => d.decode(new Uint8Array([0x28]), undefined)));
  console.log(198, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(198, 2, show(() => d.decode(new Uint8Array([0xf, 0x20, 0x5c, 0xc4, 0x5c]), { stream: false })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(199, 0, show(() => d.decode(new Uint8Array([0xa0, 0x30]), { stream: false })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(200, 0, show(() => d.decode(new Uint8Array([0xf0, 0xd, 0xf]), { stream: false })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(201, 0, show(() => d.decode(new Uint8Array([0xdf, 0x7f, 0x9b, 0xbe]))));
  console.log(201, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(201, 2, show(() => d.decode(new Uint8Array([0x80, 0x3f, 0x9b, 0xe5]), undefined)));
  console.log(201, 3, show(() => d.decode(new Uint8Array([0x1b, 0xe0, 0xe5]))));
}
{
  const d = new TextDecoder("gb18030");
  console.log(202, 0, show(() => d.decode(new Uint8Array([0x7b, 0xe0, 0x7e, 0xd]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(203, 0, show(() => d.decode(new Uint8Array([0x5f, 0x7b, 0x7f, 0xfe, 0x3f]), undefined)));
  console.log(203, 1, show(() => d.decode(new Uint8Array([0xa1]), { stream: false })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(204, 0, show(() => d.decode(new Uint8Array([0xff, 0xa1]), { stream: true })));
  console.log(204, 1, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(204, 2, show(() => d.decode(new Uint8Array([0xf, 0xfc, 0xb0]), undefined)));
  console.log(204, 3, show(() => d.decode(new Uint8Array([0xe0]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(205, 0, show(() => d.decode(new Uint8Array([0x2e]), { stream: true })));
  console.log(205, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(205, 2, show(() => d.decode(new Uint8Array([0x81, 0xa]), { stream: true })));
  console.log(205, 3, show(() => d.decode(new Uint8Array([0x7b, 0xbe, 0x9f]), { stream: true })));
  console.log(205, 4, show(() => d.decode(new Uint8Array([0xc4, 0xff, 0x5f, 0x9f]), undefined)));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(206, 0, show(() => d.decode(new Uint8Array([0x28, 0xd, 0x40]), { stream: true })));
  console.log(206, 1, show(() => d.decode(undefined, { stream: true })));
  console.log(206, 2, show(() => d.decode(new Uint8Array([0xe0, 0x80]))));
  console.log(206, 3, show(() => d.decode(new Uint8Array([0x30]), undefined)));
  console.log(206, 4, show(() => d.decode(new Uint8Array([0x24, 0xa1]), undefined)));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(207, 0, show(() => d.decode(undefined, { stream: true })));
  console.log(207, 1, show(() => d.decode(new Uint8Array([0x28, 0xa0, 0xd, 0xe, 0x5c]), { stream: false })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(208, 0, show(() => d.decode(new Uint8Array([0xd, 0x1b, 0xff]), { stream: true })));
  console.log(208, 1, show(() => d.decode(new Uint8Array([0xdf, 0x8e]), { stream: true })));
  console.log(208, 2, show(() => d.decode(new Uint8Array([0x7b, 0x2e]), { stream: true })));
  console.log(208, 3, show(() => d.decode(new Uint8Array([0xe0, 0xfc, 0x2e, 0xff]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(209, 0, show(() => d.decode(new Uint8Array([0xb0, 0xfc, 0x7b]), { stream: true })));
  console.log(209, 1, show(() => d.decode(new Uint8Array([0x9f, 0xe5, 0x20, 0x0]), undefined)));
  console.log(209, 2, show(() => d.decode(new Uint8Array([0xe]), { stream: true })));
  console.log(209, 3, show(() => d.decode(new Uint8Array([0xf0, 0xe, 0x20, 0x7b]))));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(210, 0, show(() => d.decode(new Uint8Array([0x2e, 0x28, 0x8e, 0xbe, 0xff]), { stream: true })));
  console.log(210, 1, show(() => d.decode(undefined, { stream: true })));
  console.log(210, 2, show(() => d.decode(new Uint8Array([0x3f, 0xa0, 0x7e, 0xbe, 0xff]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(211, 0, show(() => d.decode()));
  console.log(211, 1, show(() => d.decode(new Uint8Array([0x20, 0x41]), undefined)));
  console.log(211, 2, show(() => d.decode(new Uint8Array([0x20, 0x24, 0xfd]), { stream: false })));
  console.log(211, 3, show(() => d.decode(new Uint8Array([0xa, 0xdf, 0x5c, 0x39]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(212, 0, show(() => d.decode(new Uint8Array([0xfe, 0xe0]), { stream: true })));
  console.log(212, 1, show(() => d.decode(new Uint8Array([0x41, 0x21, 0x20, 0xf0]), { stream: true })));
  console.log(212, 2, show(() => d.decode(new Uint8Array([0xa0, 0xe, 0xe5, 0x8e]), { stream: false })));
  console.log(212, 3, show(() => d.decode(new Uint8Array([0x7e, 0xfe, 0x30]), { stream: false })));
  console.log(212, 4, show(() => d.decode(new Uint8Array([0xe5, 0x2e, 0xa1, 0x1b, 0x28]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(213, 0, show(() => d.decode(new Uint8Array([0x5c, 0xfc, 0x40, 0x5f, 0xe0]), undefined)));
  console.log(213, 1, show(() => d.decode(new Uint8Array([0x81, 0x40, 0x40, 0x3f]), { stream: false })));
  console.log(213, 2, show(() => d.decode(new Uint8Array([0x0, 0xf0, 0x0, 0xb0]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(214, 0, show(() => d.decode(new Uint8Array([0xbe]), { stream: true })));
  console.log(214, 1, show(() => d.decode(new Uint8Array([0xe, 0x24, 0x9f, 0xe, 0x39]), { stream: true })));
  console.log(214, 2, show(() => d.decode(new Uint8Array([0xb0]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(215, 0, show(() => d.decode(new Uint8Array([0x24, 0x7b, 0x24, 0x81, 0xdf]), undefined)));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(216, 0, show(() => d.decode(new Uint8Array([]))));
  console.log(216, 1, show(() => d.decode(new Uint8Array([0x9f]), { stream: false })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(217, 0, show(() => d.decode(new Uint8Array([0x24, 0x5f, 0x28, 0x80, 0x8e]), { stream: true })));
  console.log(217, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(217, 2, show(() => d.decode(new Uint8Array([0x7b, 0xfd, 0xe0, 0xa0, 0x7f]), { stream: true })));
  console.log(217, 3, show(() => d.decode(new Uint8Array([0x80, 0xe0]), undefined)));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(218, 0, show(() => d.decode(new Uint8Array([0xf, 0x28, 0x81, 0xe0, 0xf]))));
  console.log(218, 1, show(() => d.decode(new Uint8Array([]))));
  console.log(218, 2, show(() => d.decode(new Uint8Array([0x81]), { stream: true })));
  console.log(218, 3, show(() => d.decode(new Uint8Array([0xe, 0xa, 0x7e, 0xd]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(219, 0, show(() => d.decode(new Uint8Array([0xa1, 0x1b, 0x8f]), { stream: true })));
  console.log(219, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(219, 2, show(() => d.decode(new Uint8Array([0x7e]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(220, 0, show(() => d.decode(new Uint8Array([0xa0, 0x1b]), { stream: true })));
  console.log(220, 1, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(221, 0, show(() => d.decode(new Uint8Array([0xa, 0x7b, 0xa0, 0x7b, 0x2e]), { stream: true })));
  console.log(221, 1, show(() => d.decode(new Uint8Array([0x20, 0x30, 0x2e, 0x1b, 0x21]))));
  console.log(221, 2, show(() => d.decode(undefined, { stream: true })));
  console.log(221, 3, show(() => d.decode(new Uint8Array([0xe0, 0xa0, 0xfe, 0x9b]), { stream: true })));
}
{
  const d = new TextDecoder("big5");
  console.log(222, 0, show(() => d.decode(new Uint8Array([0xfc, 0x9b, 0x5c, 0xf0, 0xe]), { stream: true })));
  console.log(222, 1, show(() => d.decode(new Uint8Array([0x7b, 0x20, 0xbe]), { stream: true })));
  console.log(222, 2, show(() => d.decode(new Uint8Array([0x8f, 0x2e, 0x40, 0xe, 0x1b]), undefined)));
  console.log(222, 3, show(() => d.decode(new Uint8Array([0x20]))));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(223, 0, show(() => d.decode(new Uint8Array([0xff, 0xe5, 0xbe]), { stream: true })));
  console.log(223, 1, show(() => d.decode(new Uint8Array([0x7b]), undefined)));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(224, 0, show(() => d.decode(new Uint8Array([0xf0, 0x41]))));
  console.log(224, 1, show(() => d.decode(undefined, { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(225, 0, show(() => d.decode(new Uint8Array([0x5c, 0x20, 0xfe, 0x7b, 0x9f]), undefined)));
  console.log(225, 1, show(() => d.decode(new Uint8Array([0x30]))));
  console.log(225, 2, show(() => d.decode(new Uint8Array([0x41]), { stream: true })));
  console.log(225, 3, show(() => d.decode(new Uint8Array([0xc4, 0xfd, 0x0]), { stream: false })));
  console.log(225, 4, show(() => d.decode(new Uint8Array([0xdf, 0xdf, 0x41]), undefined)));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(226, 0, show(() => d.decode()));
  console.log(226, 1, show(() => d.decode(undefined, { stream: true })));
  console.log(226, 2, show(() => d.decode(new Uint8Array([0x7f, 0x28, 0xa]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(227, 0, show(() => d.decode(new Uint8Array([0x40, 0xc4]), { stream: true })));
  console.log(227, 1, show(() => d.decode(new Uint8Array([0x1b, 0x7e]), { stream: false })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(228, 0, show(() => d.decode(new Uint8Array([0xa1, 0x40]), { stream: true })));
  console.log(228, 1, show(() => d.decode(new Uint8Array([0x30]), undefined)));
  console.log(228, 2, show(() => d.decode(new Uint8Array([0x20, 0xbe]))));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(229, 0, show(() => d.decode(new Uint8Array([0x9b, 0xff, 0x41, 0xa]), { stream: false })));
  console.log(229, 1, show(() => d.decode(new Uint8Array([0x24]), { stream: true })));
  console.log(229, 2, show(() => d.decode(new Uint8Array([0xa]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(230, 0, show(() => d.decode(new Uint8Array([0x5f]), undefined)));
  console.log(230, 1, show(() => d.decode(undefined, { stream: false })));
  console.log(230, 2, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(230, 3, show(() => d.decode(new Uint8Array([0x20]), undefined)));
  console.log(230, 4, show(() => d.decode(new Uint8Array([0x80, 0xdf, 0x5f, 0xf, 0xe5]), undefined)));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(231, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(231, 1, show(() => d.decode(new Uint8Array([0xbe]), { stream: true })));
  console.log(231, 2, show(() => d.decode(new Uint8Array([0xe5, 0x28]))));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(232, 0, show(() => d.decode(new Uint8Array([0xe, 0x7e, 0x24, 0xa]), undefined)));
  console.log(232, 1, show(() => d.decode(new Uint8Array([0x81, 0x7e, 0x81]))));
}
{
  const d = new TextDecoder("gb18030");
  console.log(233, 0, show(() => d.decode(new Uint8Array([0x41, 0xa0]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(234, 0, show(() => d.decode(undefined, { stream: true })));
  console.log(234, 1, show(() => d.decode(new Uint8Array([0x41, 0x5c, 0xf, 0x30]))));
  console.log(234, 2, show(() => d.decode(new Uint8Array([0xbe, 0x7e, 0xb0]), { stream: true })));
  console.log(234, 3, show(() => d.decode(new Uint8Array([0xa1, 0x7b, 0xdf, 0xfd]), { stream: false })));
  console.log(234, 4, show(() => d.decode(new Uint8Array([0x39, 0xfe, 0x7b]), { stream: true })));
}
{
  const d = new TextDecoder("gbk");
  console.log(235, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(235, 1, show(() => d.decode(new Uint8Array([0x81]), { stream: false })));
  console.log(235, 2, show(() => d.decode(new Uint8Array([0xb0, 0x28, 0xbe, 0xbe]), { stream: true })));
  console.log(235, 3, show(() => d.decode(new Uint8Array([0xfd, 0x0, 0x39]), { stream: false })));
  console.log(235, 4, show(() => d.decode(new Uint8Array([0xa0, 0x24]), { stream: true })));
}
{
  const d = new TextDecoder("gbk");
  console.log(236, 0, show(() => d.decode(new Uint8Array([0x2e, 0xff, 0xbe, 0x81, 0x3f]), { stream: true })));
  console.log(236, 1, show(() => d.decode(new Uint8Array([]))));
  console.log(236, 2, show(() => d.decode(new Uint8Array([0x7e, 0x3f]), undefined)));
  console.log(236, 3, show(() => d.decode(undefined, { stream: true })));
  console.log(236, 4, show(() => d.decode(new Uint8Array([0xdf, 0xdf, 0x24, 0xdf]), undefined)));
}
{
  const d = new TextDecoder("gb18030");
  console.log(237, 0, show(() => d.decode(new Uint8Array([0x39]), { stream: true })));
  console.log(237, 1, show(() => d.decode(new Uint8Array([0xff]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(238, 0, show(() => d.decode(new Uint8Array([0x3f]), { stream: true })));
  console.log(238, 1, show(() => d.decode(new Uint8Array([0xfc, 0x5c, 0xa0]), { stream: true })));
  console.log(238, 2, show(() => d.decode(new Uint8Array([0x8e, 0xe0]))));
  console.log(238, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(238, 4, show(() => d.decode(new Uint8Array([0x8f, 0x2e, 0xbe, 0xfd]), undefined)));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(239, 0, show(() => d.decode(new Uint8Array([0x2e]), { stream: true })));
  console.log(239, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(240, 0, show(() => d.decode(new Uint8Array([0x80, 0xdf, 0xff, 0x2e, 0xfe]), { stream: true })));
  console.log(240, 1, show(() => d.decode(new Uint8Array([0xa0, 0xff, 0xa1, 0x30]), undefined)));
  console.log(240, 2, show(() => d.decode(undefined, { stream: true })));
  console.log(240, 3, show(() => d.decode(new Uint8Array([0xe5, 0x5f]), undefined)));
}
{
  const d = new TextDecoder("gbk");
  console.log(241, 0, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(241, 1, show(() => d.decode(new Uint8Array([0xe, 0x8f, 0xc4]), { stream: true })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(242, 0, show(() => d.decode(new Uint8Array([0x40, 0x81, 0xe0, 0xb0, 0xa1]), { stream: true })));
  console.log(242, 1, show(() => d.decode(new Uint8Array([0x5c]), undefined)));
  console.log(242, 2, show(() => d.decode(new Uint8Array([0x2e, 0xbe, 0xd, 0xe, 0x28]), { stream: true })));
  console.log(242, 3, show(() => d.decode(new Uint8Array([0x30, 0x28]), { stream: true })));
  console.log(242, 4, show(() => d.decode(new Uint8Array([0xe, 0xf0, 0x0]))));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(243, 0, show(() => d.decode(new Uint8Array([0xff, 0xfc]))));
  console.log(243, 1, show(() => d.decode(undefined, undefined)));
  console.log(243, 2, show(() => d.decode(new Uint8Array([0xf0]), { stream: false })));
  console.log(243, 3, show(() => d.decode(new Uint8Array([0x40, 0xd, 0x9b, 0xe, 0xff]), { stream: true })));
}
{
  const d = new TextDecoder("big5");
  console.log(244, 0, show(() => d.decode(new Uint8Array([0x7f]), { stream: false })));
  console.log(244, 1, show(() => d.decode(new Uint8Array([0x3f, 0xd, 0x5c]), { stream: true })));
  console.log(244, 2, show(() => d.decode(new Uint8Array([0xe5, 0x30, 0xd, 0x20, 0xfc]), { stream: true })));
  console.log(244, 3, show(() => d.decode(new Uint8Array([]), undefined)));
}
{
  const d = new TextDecoder("gbk");
  console.log(245, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(246, 0, show(() => d.decode(new Uint8Array([0x20, 0xdf, 0xfe, 0x39]), { stream: true })));
  console.log(246, 1, show(() => d.decode(new Uint8Array([0x30, 0x20, 0xdf, 0xf]))));
  console.log(246, 2, show(() => d.decode(new Uint8Array([0x40, 0x9f]))));
  console.log(246, 3, show(() => d.decode(new Uint8Array([0xa1]))));
}
{
  const d = new TextDecoder("gb18030");
  console.log(247, 0, show(() => d.decode(new Uint8Array([0x1b, 0x20, 0x7b]), { stream: true })));
  console.log(247, 1, show(() => d.decode(new Uint8Array([0xf]), undefined)));
  console.log(247, 2, show(() => d.decode(new Uint8Array([0x20]), { stream: true })));
  console.log(247, 3, show(() => d.decode(new Uint8Array([0x80, 0xff, 0xff, 0x40]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(248, 0, show(() => d.decode(undefined, { stream: false })));
  console.log(248, 1, show(() => d.decode(new Uint8Array([0xdf, 0xe5, 0xfe]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(249, 0, show(() => d.decode(new Uint8Array([0x24]), undefined)));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(250, 0, show(() => d.decode(new Uint8Array([0xf, 0x20]), { stream: true })));
  console.log(250, 1, show(() => d.decode(new Uint8Array([0x9f, 0x8e, 0xdf, 0x80, 0xbe]), { stream: true })));
  console.log(250, 2, show(() => d.decode(new Uint8Array([0x80, 0x0, 0xf0]), { stream: false })));
  console.log(250, 3, show(() => d.decode(new Uint8Array([0xb0, 0xe, 0x8e, 0x7f]), { stream: true })));
  console.log(250, 4, show(() => d.decode(new Uint8Array([0x8f, 0xf0]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(251, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(251, 1, show(() => d.decode(new Uint8Array([0x0]), { stream: false })));
  console.log(251, 2, show(() => d.decode(new Uint8Array([0x21, 0xe5, 0x21]), { stream: false })));
  console.log(251, 3, show(() => d.decode(new Uint8Array([0x20]))));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(252, 0, show(() => d.decode(new Uint8Array([0x7b, 0x8e]), { stream: false })));
  console.log(252, 1, show(() => d.decode(new Uint8Array([0xfe]), { stream: false })));
  console.log(252, 2, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(252, 3, show(() => d.decode(new Uint8Array([0x81]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(253, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(253, 1, show(() => d.decode(new Uint8Array([0xb0, 0xb0, 0x1b, 0xbe, 0x80]), undefined)));
}
{
  const d = new TextDecoder("big5");
  console.log(254, 0, show(() => d.decode(new Uint8Array([0xe0, 0xff, 0x24, 0x7b]), { stream: false })));
  console.log(254, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(254, 2, show(() => d.decode(new Uint8Array([0x81]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030");
  console.log(255, 0, show(() => d.decode(new Uint8Array([0x41, 0x8e]), { stream: true })));
  console.log(255, 1, show(() => d.decode(new Uint8Array([0xfe]), { stream: true })));
  console.log(255, 2, show(() => d.decode(new Uint8Array([]))));
  console.log(255, 3, show(() => d.decode(new Uint8Array([0x81, 0x81]), { stream: false })));
  console.log(255, 4, show(() => d.decode(new Uint8Array([0x39, 0x7f]), { stream: true })));
}
{
  const d = new TextDecoder("big5");
  console.log(256, 0, show(() => d.decode(new Uint8Array([0xe0, 0xe5]), { stream: true })));
  console.log(256, 1, show(() => d.decode(new Uint8Array([0x28, 0x7b, 0x7f, 0x1b]), undefined)));
  console.log(256, 2, show(() => d.decode(new Uint8Array([0xdf]), undefined)));
  console.log(256, 3, show(() => d.decode(new Uint8Array([0x28, 0x8f]), { stream: true })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(257, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(257, 1, show(() => d.decode(new Uint8Array([0x3f, 0x2e, 0x41, 0x2e, 0xf]), { stream: true })));
}
{
  const d = new TextDecoder("big5");
  console.log(258, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(258, 1, show(() => d.decode(new Uint8Array([0xb0, 0xbe, 0xd]), { stream: false })));
  console.log(258, 2, show(() => d.decode(new Uint8Array([0x3f, 0x9f, 0xff, 0xfd]), { stream: true })));
  console.log(258, 3, show(() => d.decode()));
  console.log(258, 4, show(() => d.decode(new Uint8Array([0x8e, 0x80]))));
}
{
  const d = new TextDecoder("gb18030");
  console.log(259, 0, show(() => d.decode(undefined, { stream: true })));
  console.log(259, 1, show(() => d.decode(new Uint8Array([0xfd]), { stream: false })));
  console.log(259, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(259, 3, show(() => d.decode(new Uint8Array([0xf, 0xf0, 0xe]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(260, 0, show(() => d.decode(new Uint8Array([0x7b]), undefined)));
  console.log(260, 1, show(() => d.decode(new Uint8Array([0x24]), undefined)));
  console.log(260, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(260, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(260, 4, show(() => d.decode(undefined, { stream: true })));
}
{
  const d = new TextDecoder("big5");
  console.log(261, 0, show(() => d.decode(new Uint8Array([0xfd, 0x7b, 0xa0, 0x20]))));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(262, 0, show(() => d.decode(new Uint8Array([0x2e, 0xdf, 0xe5, 0x7e, 0xfc]), { stream: true })));
  console.log(262, 1, show(() => d.decode(undefined, undefined)));
  console.log(262, 2, show(() => d.decode(new Uint8Array([0x7e]), undefined)));
  console.log(262, 3, show(() => d.decode(new Uint8Array([0xfe, 0x5f]), { stream: false })));
}
{
  const d = new TextDecoder("gbk");
  console.log(263, 0, show(() => d.decode(new Uint8Array([0x40, 0x39, 0xf, 0xff, 0x2e]))));
  console.log(263, 1, show(() => d.decode(undefined, undefined)));
  console.log(263, 2, show(() => d.decode(undefined, { stream: false })));
  console.log(263, 3, show(() => d.decode(new Uint8Array([0x9f]), { stream: false })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(264, 0, show(() => d.decode(new Uint8Array([0xf, 0x81, 0x9f, 0xa, 0xfe]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(265, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(265, 1, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(265, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(265, 3, show(() => d.decode(new Uint8Array([0x9b]), { stream: false })));
}
{
  const d = new TextDecoder("big5");
  console.log(266, 0, show(() => d.decode(new Uint8Array([0xfe, 0xb0, 0x40, 0x81]), { stream: true })));
  console.log(266, 1, show(() => d.decode(new Uint8Array([0x39, 0xf0]), { stream: true })));
  console.log(266, 2, show(() => d.decode(new Uint8Array([0xf0]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(267, 0, show(() => d.decode(new Uint8Array([0x9f, 0xe5]))));
}
{
  const d = new TextDecoder("gb18030");
  console.log(268, 0, show(() => d.decode(undefined, { stream: true })));
  console.log(268, 1, show(() => d.decode(new Uint8Array([0xff, 0x9b, 0x28]), undefined)));
  console.log(268, 2, show(() => d.decode(new Uint8Array([0x7e, 0x9f]))));
  console.log(268, 3, show(() => d.decode(new Uint8Array([0x1b, 0x7f, 0xe5]))));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(269, 0, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(270, 0, show(() => d.decode(new Uint8Array([0x7b, 0xe0, 0x30]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(271, 0, show(() => d.decode(new Uint8Array([0x41, 0x7e]), { stream: true })));
  console.log(271, 1, show(() => d.decode(new Uint8Array([0x7f, 0x2e, 0xf]), { stream: true })));
  console.log(271, 2, show(() => d.decode(new Uint8Array([0xf0, 0xa1]), { stream: false })));
  console.log(271, 3, show(() => d.decode(new Uint8Array([0x41, 0xbe, 0x8f, 0xe0]), undefined)));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(272, 0, show(() => d.decode(new Uint8Array([0xfc, 0xa0, 0xa1, 0xff]), { stream: true })));
  console.log(272, 1, show(() => d.decode(new Uint8Array([0x21]), { stream: true })));
  console.log(272, 2, show(() => d.decode(new Uint8Array([0xe, 0x7b]), { stream: true })));
  console.log(272, 3, show(() => d.decode(new Uint8Array([0x1b, 0x28, 0xf, 0xfc]), { stream: true })));
  console.log(272, 4, show(() => d.decode(new Uint8Array([0x24]))));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(273, 0, show(() => d.decode(new Uint8Array([0x3f]))));
  console.log(273, 1, show(() => d.decode(new Uint8Array([0x8f, 0xe5, 0xff, 0x7b, 0x5f]), { stream: true })));
  console.log(273, 2, show(() => d.decode(new Uint8Array([0x1b, 0xa0, 0x5c, 0x20, 0xe5]), { stream: true })));
  console.log(273, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(274, 0, show(() => d.decode(new Uint8Array([0xff, 0xbe, 0x2e, 0x80, 0x7e]))));
  console.log(274, 1, show(() => d.decode(new Uint8Array([0x9b, 0x5f]), undefined)));
  console.log(274, 2, show(() => d.decode(new Uint8Array([0x39, 0x0, 0xc4]), { stream: true })));
  console.log(274, 3, show(() => d.decode(undefined, { stream: true })));
  console.log(274, 4, show(() => d.decode(new Uint8Array([0x20, 0xff]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(275, 0, show(() => d.decode(new Uint8Array([0xdf, 0xc4, 0xa0, 0x0, 0xc4]))));
  console.log(275, 1, show(() => d.decode(new Uint8Array([0x8f]), { stream: true })));
  console.log(275, 2, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(276, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(276, 1, show(() => d.decode(new Uint8Array([0xb0, 0x7e, 0x41]), { stream: true })));
  console.log(276, 2, show(() => d.decode(new Uint8Array([0x21]), undefined)));
  console.log(276, 3, show(() => d.decode(new Uint8Array([0xdf, 0x8f, 0xb0, 0x8e]))));
  console.log(276, 4, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(277, 0, show(() => d.decode(new Uint8Array([0x0, 0x40, 0xbe]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(278, 0, show(() => d.decode(new Uint8Array([0x30, 0x7f, 0xf, 0x24]), undefined)));
  console.log(278, 1, show(() => d.decode(new Uint8Array([0x2e]), undefined)));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(279, 0, show(() => d.decode()));
  console.log(279, 1, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(279, 2, show(() => d.decode(new Uint8Array([0x7b, 0xe5]), { stream: true })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(280, 0, show(() => d.decode(new Uint8Array([0xa, 0xbe, 0xbe, 0x80]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(281, 0, show(() => d.decode(new Uint8Array([]), undefined)));
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  console.log(282, 0, show(() => d.decode(new Uint8Array([]), undefined)));
}
{
  const d = new TextDecoder("gbk");
  console.log(283, 0, show(() => d.decode(new Uint8Array([0xff]), undefined)));
  console.log(283, 1, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(284, 0, show(() => d.decode(new Uint8Array([0xfc, 0xb0]), { stream: true })));
  console.log(284, 1, show(() => d.decode(new Uint8Array([0x7e, 0xf0, 0x21]), { stream: true })));
  console.log(284, 2, show(() => d.decode(new Uint8Array([0xd, 0xa0, 0xfe, 0x8f, 0x41]), { stream: true })));
  console.log(284, 3, show(() => d.decode(new Uint8Array([0xfe, 0xe0, 0xfc]), undefined)));
  console.log(284, 4, show(() => d.decode(new Uint8Array([0xdf, 0x7e, 0xdf]))));
}
{
  const d = new TextDecoder("big5");
  console.log(285, 0, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(285, 1, show(() => d.decode(new Uint8Array([0xff, 0xff, 0x21]), { stream: false })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(286, 0, show(() => d.decode(new Uint8Array([0x1b, 0xc4, 0xb0, 0x40]), { stream: false })));
  console.log(286, 1, show(() => d.decode(undefined, undefined)));
  console.log(286, 2, show(() => d.decode(new Uint8Array([0xe, 0x5f, 0x9f]), { stream: true })));
  console.log(286, 3, show(() => d.decode(new Uint8Array([0xe0, 0x40, 0x0, 0x30]))));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(287, 0, show(() => d.decode(new Uint8Array([0x9f, 0x0, 0x20]), { stream: true })));
  console.log(287, 1, show(() => d.decode(new Uint8Array([0x9f]))));
  console.log(287, 2, show(() => d.decode(new Uint8Array([0xe5, 0x7f, 0xfe]), { stream: true })));
  console.log(287, 3, show(() => d.decode(new Uint8Array([0xdf, 0xf0, 0xc4, 0x81, 0xe5]))));
}
{
  const d = new TextDecoder("gb18030");
  console.log(288, 0, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(288, 1, show(() => d.decode(new Uint8Array([0x40]), { stream: true })));
  console.log(288, 2, show(() => d.decode(new Uint8Array([]), { stream: false })));
  console.log(288, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(289, 0, show(() => d.decode(new Uint8Array([0x81, 0xe0, 0x41, 0xd]), { stream: true })));
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  console.log(290, 0, show(() => d.decode(new Uint8Array([0xe5, 0xe, 0x80, 0x40, 0xe0]), { stream: true })));
  console.log(290, 1, show(() => d.decode(new Uint8Array([0xa0, 0x8f]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr");
  console.log(291, 0, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(291, 1, show(() => d.decode(new Uint8Array([0xe0, 0x7f, 0xfc]), undefined)));
  console.log(291, 2, show(() => d.decode(new Uint8Array([0x5c, 0xe, 0x81]), { stream: true })));
  console.log(291, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(291, 4, show(() => d.decode(new Uint8Array([0x5f, 0xf0, 0x40, 0x1b]), { stream: false })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(292, 0, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(292, 1, show(() => d.decode(new Uint8Array([0x39, 0xfc, 0xa0, 0xf0, 0x7f]), { stream: true })));
  console.log(292, 2, show(() => d.decode(new Uint8Array([0x20]), { stream: true })));
  console.log(292, 3, show(() => d.decode(new Uint8Array([0x9b, 0x5c]), { stream: true })));
  console.log(292, 4, show(() => d.decode(undefined, { stream: true })));
}
{
  const d = new TextDecoder("euc-jp");
  console.log(293, 0, show(() => d.decode(new Uint8Array([0xfe]), { stream: true })));
  console.log(293, 1, show(() => d.decode(new Uint8Array([0x80]), { stream: true })));
  console.log(293, 2, show(() => d.decode(new Uint8Array([0xfe, 0xa, 0xff, 0xf0, 0xdf]))));
  console.log(293, 3, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(293, 4, show(() => d.decode(new Uint8Array([0x40, 0xf0, 0x40, 0x39]), { stream: true })));
}
{
  const d = new TextDecoder("big5", { fatal: true });
  console.log(294, 0, show(() => d.decode(new Uint8Array([]), undefined)));
  console.log(294, 1, show(() => d.decode(new Uint8Array([0x8e, 0xff, 0x7e, 0xf0]), undefined)));
  console.log(294, 2, show(() => d.decode(new Uint8Array([0x5c]), { stream: true })));
  console.log(294, 3, show(() => d.decode(new Uint8Array([]), { stream: false })));
}
{
  const d = new TextDecoder("big5");
  console.log(295, 0, show(() => d.decode(new Uint8Array([0x28, 0x3f]))));
  console.log(295, 1, show(() => d.decode(new Uint8Array([0x1b, 0xd, 0x8e, 0x40, 0x5f]), { stream: true })));
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  console.log(296, 0, show(() => d.decode(new Uint8Array([]))));
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  console.log(297, 0, show(() => d.decode(new Uint8Array([]), { stream: true })));
  console.log(297, 1, show(() => d.decode(new Uint8Array([0x80, 0xf0, 0x0]), { stream: true })));
}
{
  const d = new TextDecoder("shift_jis");
  console.log(298, 0, show(() => d.decode(new Uint8Array([0x3f, 0xb0, 0x24, 0x2e]), undefined)));
  console.log(298, 1, show(() => d.decode(new Uint8Array([0x81, 0xa]))));
  console.log(298, 2, show(() => d.decode(new Uint8Array([0x5f, 0x9b, 0xfc, 0xe]), undefined)));
}
{
  const d = new TextDecoder("big5");
  console.log(299, 0, show(() => d.decode(new Uint8Array([0xd, 0xff, 0x0, 0xd, 0x3f]), { stream: true })));
  console.log(299, 1, show(() => d.decode(new Uint8Array([0x9f, 0xfc, 0xfe, 0xfe]), { stream: true })));
  console.log(299, 2, show(() => d.decode(new Uint8Array([0xb0, 0x30, 0xff, 0x40]), undefined)));
}
