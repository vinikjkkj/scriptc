#!/usr/bin/env python3
# perf script -F comm,tid,ip,sym output on stdin -> folded stacks "comm;outer;...;leaf count" on stdout (root first), one line per unique stack.
import sys,collections
cnt=collections.Counter(); comm=None; stack=[]
def flush():
    global stack,comm
    if comm is not None and stack:
        cnt[comm+';'+';'.join(reversed(stack))]+=1
    stack=[];comm=None
for line in sys.stdin:
    line=line.rstrip('\n')
    if not line.strip():
        flush(); continue
    if not line[0].isspace():
        flush(); comm=line.split()[0] if line.split() else 'unknown'; continue
    parts=line.split(None,1)
    sym=parts[1] if len(parts)>1 else parts[0]
    sym=sym.split('+0x')[0].strip()
    if sym in ('[unknown]',''): sym='[unknown]'
    stack.append(sym)
flush()
for k,v in cnt.most_common(): print(k,v)
