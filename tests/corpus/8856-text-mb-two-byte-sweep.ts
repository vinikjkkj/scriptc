function hashOf(s: string, h: number): number {
  let r = h;
  for (let i = 0; i < s.length; i++) r = (r * 31 + s.charCodeAt(i)) % 2147483629;
  return r;
}
function run(f: () => string): string {
  try {
    return "O" + f();
  } catch {
    return "E";
  }
}

{
  const d = new TextDecoder("gbk");
  for (let lead = 0; lead < 256; lead++) {
    let h = 0;
    for (let trail = 0; trail < 256; trail++) {
      h = hashOf(run(() => d.decode(new Uint8Array([lead, trail]))), h);
    }
    console.log("gbk", "plain", lead, h);
  }
}
{
  const d = new TextDecoder("gbk", { fatal: true });
  for (let lead = 0; lead < 256; lead++) {
    let h = 0;
    for (let trail = 0; trail < 256; trail++) {
      h = hashOf(run(() => d.decode(new Uint8Array([lead, trail]))), h);
    }
    console.log("gbk", "fatal", lead, h);
  }
}
{
  const d = new TextDecoder("gb18030");
  for (let lead = 0; lead < 256; lead++) {
    let h = 0;
    for (let trail = 0; trail < 256; trail++) {
      h = hashOf(run(() => d.decode(new Uint8Array([lead, trail]))), h);
    }
    console.log("gb18030", "plain", lead, h);
  }
}
{
  const d = new TextDecoder("gb18030", { fatal: true });
  for (let lead = 0; lead < 256; lead++) {
    let h = 0;
    for (let trail = 0; trail < 256; trail++) {
      h = hashOf(run(() => d.decode(new Uint8Array([lead, trail]))), h);
    }
    console.log("gb18030", "fatal", lead, h);
  }
}
{
  const d = new TextDecoder("big5");
  for (let lead = 0; lead < 256; lead++) {
    let h = 0;
    for (let trail = 0; trail < 256; trail++) {
      h = hashOf(run(() => d.decode(new Uint8Array([lead, trail]))), h);
    }
    console.log("big5", "plain", lead, h);
  }
}
{
  const d = new TextDecoder("big5", { fatal: true });
  for (let lead = 0; lead < 256; lead++) {
    let h = 0;
    for (let trail = 0; trail < 256; trail++) {
      h = hashOf(run(() => d.decode(new Uint8Array([lead, trail]))), h);
    }
    console.log("big5", "fatal", lead, h);
  }
}
{
  const d = new TextDecoder("euc-jp");
  for (let lead = 0; lead < 256; lead++) {
    let h = 0;
    for (let trail = 0; trail < 256; trail++) {
      h = hashOf(run(() => d.decode(new Uint8Array([lead, trail]))), h);
    }
    console.log("euc-jp", "plain", lead, h);
  }
}
{
  const d = new TextDecoder("euc-jp", { fatal: true });
  for (let lead = 0; lead < 256; lead++) {
    let h = 0;
    for (let trail = 0; trail < 256; trail++) {
      h = hashOf(run(() => d.decode(new Uint8Array([lead, trail]))), h);
    }
    console.log("euc-jp", "fatal", lead, h);
  }
}
{
  const d = new TextDecoder("shift_jis");
  for (let lead = 0; lead < 256; lead++) {
    let h = 0;
    for (let trail = 0; trail < 256; trail++) {
      h = hashOf(run(() => d.decode(new Uint8Array([lead, trail]))), h);
    }
    console.log("shift_jis", "plain", lead, h);
  }
}
{
  const d = new TextDecoder("shift_jis", { fatal: true });
  for (let lead = 0; lead < 256; lead++) {
    let h = 0;
    for (let trail = 0; trail < 256; trail++) {
      h = hashOf(run(() => d.decode(new Uint8Array([lead, trail]))), h);
    }
    console.log("shift_jis", "fatal", lead, h);
  }
}
{
  const d = new TextDecoder("euc-kr");
  for (let lead = 0; lead < 256; lead++) {
    let h = 0;
    for (let trail = 0; trail < 256; trail++) {
      h = hashOf(run(() => d.decode(new Uint8Array([lead, trail]))), h);
    }
    console.log("euc-kr", "plain", lead, h);
  }
}
{
  const d = new TextDecoder("euc-kr", { fatal: true });
  for (let lead = 0; lead < 256; lead++) {
    let h = 0;
    for (let trail = 0; trail < 256; trail++) {
      h = hashOf(run(() => d.decode(new Uint8Array([lead, trail]))), h);
    }
    console.log("euc-kr", "fatal", lead, h);
  }
}
{
  const d = new TextDecoder("gb18030");
  for (let b1 = 0x81; b1 <= 0xfe; b1++) {
    let h = 0;
    for (let b2 = 0x30; b2 <= 0x39; b2++) {
      for (let b3 = 0x81; b3 <= 0xfe; b3++) {
        for (let b4 = 0x30; b4 <= 0x39; b4++) {
          h = hashOf(run(() => d.decode(new Uint8Array([b1, b2, b3, b4]))), h);
        }
      }
    }
    console.log("gb18030-4", b1, h);
  }
}
{
  const d = new TextDecoder("euc-jp");
  const df = new TextDecoder("euc-jp", { fatal: true });
  for (let b2 = 0xa1; b2 <= 0xfe; b2++) {
    let h = 0;
    let hf = 0;
    for (let b3 = 0xa1; b3 <= 0xfe; b3++) {
      h = hashOf(run(() => d.decode(new Uint8Array([0x8f, b2, b3]))), h);
      hf = hashOf(run(() => df.decode(new Uint8Array([0x8f, b2, b3, 0x41]))), hf);
    }
    console.log("euc-jp-3", b2, h, hf);
  }
}
