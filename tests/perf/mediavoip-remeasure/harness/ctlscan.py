"""Scan bytes for C0 control characters other than tab/CR/LF.

A shell heredoc on this host eats one level of backslash, and anything that then
interprets escapes turns the survivors into control bytes -- a literal BACKSPACE
inside a committed regex is the documented failure. This scans stdin.

CONTROLS, run every time before the real scan:
  MUST FLAG : a string carrying 0x08 and 0x1b
  MUST PASS : a string of plain text with tab, CR and LF in it
If either control misbehaves, the scan is broken and its "clean" is worthless.
"""

import sys

BAD = set(range(0x00, 0x09)) | {0x0B, 0x0C} | set(range(0x0E, 0x20))


def scan(data):
    return sorted({b for b in data if b in BAD})


must_flag = b"a regex with \x08 and \x1b in it"
must_pass = b"plain text\twith a tab\r\nand a newline\n"
ok = scan(must_flag) == [0x08, 0x1B] and scan(must_pass) == []
print("CONTROL must-flag -> %s   CONTROL must-pass -> %s   %s"
      % (scan(must_flag), scan(must_pass), "ARMED" if ok else "BROKEN"))
if not ok:
    print("CTLSCAN=BROKEN")
    sys.exit(2)

data = sys.stdin.buffer.read()
found = scan(data)
if found:
    print("CTLSCAN=FAIL  bytes present: %s" % [hex(b) for b in found])
    sys.exit(1)
print("CTLSCAN=PASS  %d bytes scanned, no C0 control other than tab/CR/LF" % len(data))
