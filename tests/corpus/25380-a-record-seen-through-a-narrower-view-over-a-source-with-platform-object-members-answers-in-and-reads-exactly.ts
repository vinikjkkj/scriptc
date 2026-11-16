// the shape of zapo's WaMediaTransferClient.downloadAndDecryptStream: a request record with an AbortSignal and an http.Agent member flows into a narrower parameter (a struct view of the source), which then flows into a narrower Pick (a copy that asks which keys are present)
import http from "node:http";
interface StreamRequest {
  readonly url?: string;
  readonly directPath?: string;
  readonly hosts?: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly agent?: http.Agent;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
}
interface EncryptedRequest extends StreamRequest {
  readonly mediaType: string;
  readonly mediaKey: Uint8Array;
}
type Resolved = Pick<StreamRequest, "url" | "directPath" | "hosts" | "headers" | "timeoutMs">;
function resolve(r: Resolved): string {
  const keys = ("url" in r ? "U" : "-") + ("directPath" in r ? "D" : "-") + ("hosts" in r ? "H" : "-") + ("headers" in r ? "E" : "-") + ("timeoutMs" in r ? "T" : "-");
  return keys + "|" + (r.url ?? "") + "|" + (r.directPath ?? "") + "|" + String(r.timeoutMs ?? 0) + "|" + String(r.hosts?.length ?? 0) + "|" + Object.keys(r.headers ?? {}).join(",");
}
class Client {
  async downloadStream(request: StreamRequest): Promise<string> {
    const flags = (request.agent ? "A" : "n") + (request.signal ? "S" : "n") + (request.maxBytes !== undefined ? "M" : "n");
    return resolve(request) + "|" + flags;
  }
  async downloadAndDecryptStream(request: EncryptedRequest): Promise<string> {
    return (await this.downloadStream(request)) + ":" + request.mediaType + ":" + request.mediaKey.length;
  }
}
async function main(): Promise<void> {
  const c = new Client();
  const ac = new AbortController();
  const out: string[] = [];
  out.push(await c.downloadAndDecryptStream({ directPath: "/v/t", mediaType: "history", mediaKey: new Uint8Array(4), timeoutMs: 5, hosts: ["a", "b"] }));
  out.push(await c.downloadAndDecryptStream({ url: "u", mediaType: "x", mediaKey: new Uint8Array(1), signal: ac.signal, agent: new http.Agent(), headers: { k: "v", w: "z" } }));
  out.push(await c.downloadAndDecryptStream({ mediaType: "y", mediaKey: new Uint8Array(0), url: undefined, timeoutMs: undefined, maxBytes: 9, signal: ac.signal }));
  out.push(await c.downloadAndDecryptStream({ mediaType: "z", mediaKey: new Uint8Array(2), hosts: [], headers: {}, agent: new http.Agent() }));
  for (let i = 0; i < 300; i++) out.push(await c.downloadAndDecryptStream({ url: "n" + i, mediaType: "m", mediaKey: new Uint8Array(i % 3), timeoutMs: i, signal: i % 2 ? ac.signal : undefined }));
  console.log(out.length, out.slice(0, 4).join("\n"), out[out.length - 1]);
}
main();
