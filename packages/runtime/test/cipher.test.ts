import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, exeSuffix } from "./cc.js";
import { beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const bin = join(testDir, "build", "test_cipher" + exeSuffix);

// scr_cipher.c is deliberately free of ScrBytes and every other runtime
// type, so this binary is the primitive and NOTHING else: two translation
// units, no runtime, no libc shim. A failure here can only mean AES is
// wrong. test_cipher.c checks it against the published vectors — FIPS 197
// C.3, SP 800-38A F.2.5/F.2.6 (CBC) and F.5.5/F.5.6 (CTR), SP 800-38D GCM
// cases 13-16 — plus the properties no vector reaches: PKCS#7 either side
// of a block boundary, a refused pad, in-place decryption, a refused GCM
// tag (with the plaintext buffer proven untouched), and the GHASH-derived
// J0 path for non-96-bit IVs.
beforeAll(async () => {
  await mkdir(join(testDir, "build"), { recursive: true });
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra",
    "-I", join(testDir, "../src"),
    "-o", bin,
    join(testDir, "test_cipher.c"),
    join(testDir, "../src/scr_cipher.c"),
  ]);
});

test("aes-256: the published CBC/CTR/GCM vectors, padding and tag rejection", async () => {
  const { stdout } = await execFileAsync(bin, []);
  expect(stdout.trim()).toBe("cipher ok");
});
