// os.tmpdir() is NOT GetTempPath and NOT uv_os_tmpdir — on Windows it is
// plain JS over process.env (lib/os.js), and the three disagree on six
// separate axes. The variables are set by this program, so both sides read
// exactly the same environment and the raw values compare byte-for-byte.
//
// GetTempPathA, which the runtime used to call, reads TMP before TEMP,
// rewrites '/' to '\', collapses repeated separators, absolutizes a
// relative value against the cwd, and caps at MAX_PATH (falling back to
// the profile directory — a DIFFERENT VOLUME than the one asked for).
import { tmpdir } from "node:os";

const isWindows = process.platform === "win32";

if (isWindows) {
  // TEMP is consulted BEFORE TMP. GetTempPath has the order backwards.
  process.env.TMP = "G:\\aaa";
  process.env.TEMP = "G:\\bbb";
  console.log(tmpdir());

  // An empty TEMP falls through to TMP, like `a || b`.
  process.env.TEMP = "";
  console.log(tmpdir());

  // A drive root KEEPS its separator: "C:" would be drive-RELATIVE and
  // resolve against that drive's current directory instead.
  process.env.TEMP = "C:\\";
  console.log(tmpdir());

  // Exactly ONE trailing backslash comes off, never two.
  process.env.TEMP = "G:\\p\\q\\\\";
  console.log(tmpdir());

  // Forward slashes are not separators to this rule: neither trimmed nor
  // rewritten, and interior runs are left alone.
  process.env.TEMP = "G:/x/y/";
  console.log(tmpdir());
  process.env.TEMP = "G:\\a/b\\";
  console.log(tmpdir());

  // A UNC path loses its one trailing backslash like any other.
  process.env.TEMP = "\\\\srv\\share\\t\\";
  console.log(tmpdir());

  // A relative value is answered verbatim — no cwd absolutization. The
  // comparison is structural because the cwd must not leak into output.
  process.env.TEMP = "rel";
  console.log(tmpdir() === "rel");
  process.env.TEMP = "G:sub";
  console.log(tmpdir() === "G:sub");

  // Past MAX_PATH the answer is still the variable, not a fallback.
  const long = "G:\\" + "x".repeat(300);
  process.env.TEMP = long;
  console.log(tmpdir() === long, tmpdir().length);
} else {
  // The POSIX arm: TMPDIR first, one trailing '/' trimmed, "/tmp" default.
  process.env.TMPDIR = "/aaa/";
  console.log(tmpdir());
  process.env.TMPDIR = "/";
  console.log(tmpdir());
  process.env.TMPDIR = "";
  process.env.TMP = "/bbb";
  console.log(tmpdir());
  process.env.TMPDIR = "/rel/x//";
  console.log(tmpdir());
}
