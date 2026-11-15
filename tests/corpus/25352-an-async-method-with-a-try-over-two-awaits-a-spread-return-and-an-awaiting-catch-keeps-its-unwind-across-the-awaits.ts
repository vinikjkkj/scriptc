// the control flow of zapo's WaMediaCrypto.encryptToFile (zapo-js 1.8.2, dist/esm/media/crypto/WaMediaCrypto.js:179), with the crypto and fs calls replaced by async functions of the same shape
interface EncOptions { sidecar?: boolean; firstFrameLength?: number; expectedFileSize?: number }
interface EncMeta { plainHash: string; encHash: string; plaintextLength: number }
interface Keys { encKey: string; macKey: string }
let failAt = -1;
let unlinked = 0;
function tmpdir(): string { return "/tmp"; }
function join(a: string, b: string): string { return a + "/" + b; }
function createWriteStream(p: string): { path: string; chunks: string[] } { return { path: p, chunks: [] }; }
async function pumpEncryption(plaintext: string[], output: { path: string; chunks: string[] }, keys: Keys, computeSidecar: boolean, firstFrameLength: number | undefined, expectedFileSize: number | undefined): Promise<EncMeta> {
  let len = 0;
  for (const c of plaintext) {
    await null;
    if (failAt === 1) throw new Error("pump " + c);
    output.chunks.push(c + keys.encKey);
    len += c.length;
  }
  return { plainHash: "p" + len + (computeSidecar ? "s" : "n") + (firstFrameLength ?? 0), encHash: "e" + (expectedFileSize ?? 0), plaintextLength: len };
}
async function stat(p: string): Promise<{ size: number }> { await null; if (failAt === 2) throw new Error("stat " + p); return { size: p.length }; }
async function unlink(p: string): Promise<void> { await null; unlinked++; if (failAt === 3) throw new Error("unlink " + p); }
class MediaCryptoX {
  static deriveKeys(mediaType: string, mediaKey: string): Keys { return { encKey: mediaType + "E", macKey: mediaKey + "M" }; }
  static async encryptToFile(mediaType: string, mediaKey: string, plaintext: string[], options?: EncOptions): Promise<{ filePath: string; fileSize: number; plainHash: string; encHash: string; plaintextLength: number }> {
    const keys = MediaCryptoX.deriveKeys(mediaType, mediaKey);
    const filePath = join(tmpdir(), `zapo-enc-${plaintext.length}-${7}`);
    const output = createWriteStream(filePath);
    try {
      const metadata = await pumpEncryption(plaintext, output, keys, options?.sidecar !== false, options?.firstFrameLength, options?.expectedFileSize);
      const fileSize = (await stat(filePath)).size;
      return { filePath, fileSize, ...metadata };
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  }
}
(async () => {
  let acc = "";
  for (failAt = -1; failAt <= 3; failAt++) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await MediaCryptoX.encryptToFile("img", "k" + i, ["a", "bb", "ccc"], i === 1 ? { sidecar: false, firstFrameLength: 4 } : i === 2 ? { expectedFileSize: 9 } : undefined);
        acc += r.fileSize + r.plainHash + r.encHash + r.plaintextLength + ";";
      } catch (e) {
        acc += "E:" + (e as Error).message + ";";
      }
    }
  }
  console.log(acc, unlinked);
})();
