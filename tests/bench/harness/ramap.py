#!/usr/bin/env python3
"""ramap.py <out.json> -- cmd args...   (env passed through; same call shape as smapspeak.py, a superset of its output)
A peak-RSS map of ONE process. The lane's VmRSS/VmHWM are polled every ~2 ms; every time the kernel's VmHWM rises the process's smaps, and the
page-presence bitmap (/proc/pid/pagemap) of the main executable's r-x mapping, are snapshotted (never more often than every 3 ms), so the snapshot kept
is the one taken after the LAST rise: the VmHWM instant. Each snapshot records its own VmRSS and the VmHWM seen at that poll, and the result says how
far the kept snapshot is from the final VmHWM (`peak_gap_kb`), so a sampler that missed the peak says so.
Output (JSON): everything smapspeak.py reports (classes with Rss/Pss/Private_Dirty/Anonymous, peak_vmrss_kb, peak_at_s, timeline) plus
  classes[*].Shared_Clean / Private_Clean / Shared_Dirty, libs (shared libraries split: icu, libc, libstdc++/libgcc, other), mappings (top 25 by Rss
  with address, perms, name, Size, Rss, Pss, Shared_Clean, Private_Clean, Private_Dirty, Anonymous), events (one row per HWM rise: t, vmrss, hwm,
  heap/anon/code Rss), and, when the binary has symbols, the RESIDENT TEXT by function and by origin (text_origin, text_top30, text_pages): for every
  function symbol, the bytes of it that lie in pages the pagemap reports present. Origin of an `sc_*` function comes from <binary minus .bin>.symfile.tsv
  (symbol<TAB>source path, written by symfile.py from the kept C), mapped to app / zapo-js / npm:<package> / other; runtime and vendored code are named
  by symbol prefix. A page is attributed to EVERY function overlapping it, so a resident page of one hot function also counts its cold neighbours
  (that is exactly what makes a scattered layout expensive); `text_top30` is therefore "functions with at least one resident page", biggest first.
RAMAP_SIGNAL=USR2 additionally sends that signal to the lane at every HWM rise (a census hook may dump on it). Stdout goes to <out>.stdout unless
SMAPS_STDOUT=inherit."""
import sys, os, time, json, subprocess, re, signal, struct

out = sys.argv[1]; cmd = sys.argv[sys.argv.index('--') + 1:]
so = None if os.environ.get('SMAPS_STDOUT') == 'inherit' else open(out + '.stdout', 'wb')
sig = os.environ.get('RAMAP_SIGNAL')
p = subprocess.Popen(cmd, stdout=so, stderr=subprocess.STDOUT)
pid = p.pid
exe_base = os.path.basename(cmd[0])
t0 = time.time()
FIELDS = ('Size', 'Rss', 'Pss', 'Shared_Clean', 'Shared_Dirty', 'Private_Clean', 'Private_Dirty', 'Anonymous')
HEAD = re.compile(r'^([0-9a-f]+)-([0-9a-f]+) (\S+) ([0-9a-f]+) \S+ \d+\s*(.*)$')

def status():
    try:
        rss = hwm = None
        with open(f'/proc/{pid}/status') as f:
            for l in f:
                if l.startswith('VmRSS:'): rss = int(l.split()[1])
                elif l.startswith('VmHWM:'): hwm = int(l.split()[1])
        return rss, hwm
    except Exception:
        return None, None

def parse_smaps(s):
    maps = []; cur = None
    for l in s.split('\n'):
        m = HEAD.match(l)
        if m:
            cur = {'start': int(m.group(1), 16), 'end': int(m.group(2), 16), 'perms': m.group(3), 'pgoff': int(m.group(4), 16), 'name': m.group(5).strip()}
            for k in FIELDS: cur[k] = 0
            maps.append(cur); continue
        if cur is not None:
            i = l.find(':')
            if i > 0:
                k = l[:i]
                if k in FIELDS:
                    try: cur[k] = int(l[i + 1:].split()[0])
                    except Exception: pass
    return maps

def classify(mp):
    name, perms = mp['name'], mp['perms']
    if name == '[heap]': return 'heap(brk)'
    if name.startswith('[stack'): return 'stack'
    if name.startswith('[v'): return 'vdso/vvar'
    if name == '': return 'anon-mmap'
    if name.startswith('/'):
        base = os.path.basename(name)
        kind = 'main-binary' if base == exe_base else 'shared-libs'
        return f'{kind}:' + ('code(r-x)' if 'x' in perms else 'rw-data' if 'w' in perms else 'rodata(r--)')
    return 'other:' + name

def lib_group(name):
    b = os.path.basename(name)
    if b.startswith('libicu'): return 'icu'
    if b.startswith(('libc.', 'libc-', 'ld-linux', 'libm.', 'libm-', 'libpthread', 'libdl', 'librt')): return 'libc/ld/libm'
    if b.startswith(('libstdc++', 'libgcc')): return 'libstdc++/libgcc'
    return 'other-libs'

def summarize(maps):
    cls = {}; libs = {}
    for mp in maps:
        c = classify(mp)
        d = cls.setdefault(c, {k: 0 for k in FIELDS}); d['maps'] = d.get('maps', 0) + 1
        for k in FIELDS: d[k] += mp[k]
        if c.startswith('shared-libs'):
            g = lib_group(mp['name'])
            e = libs.setdefault(g, {k: 0 for k in FIELDS})
            for k in FIELDS: e[k] += mp[k]
    return cls, libs

def read_pagemap(maps):
    """present-bit bitmap of the main binary's r-x mapping(s): [(start, end, bytes-of-0/1 per page)]"""
    res = []
    try:
        fd = os.open(f'/proc/{pid}/pagemap', os.O_RDONLY)
    except Exception:
        return res
    try:
        for mp in maps:
            if os.path.basename(mp['name']) == exe_base and 'x' in mp['perms']:
                npg = (mp['end'] - mp['start']) // 4096
                raw = os.pread(fd, npg * 8, (mp['start'] // 4096) * 8)
                if len(raw) != npg * 8: continue
                ent = struct.unpack(f'<{npg}Q', raw)
                res.append((mp['start'], mp['end'], bytes(1 if e >> 63 & 1 else 0 for e in ent)))
    except Exception:
        pass
    finally:
        os.close(fd)
    return res

best = None; best_rss = 0; best_t = 0.0; last_hwm = 0; last_snap_t = 0.0; samples = 0; tl = []; events = []; final_hwm = 0; final_rss = 0
while p.poll() is None:
    rss, hwm = status()
    now = time.time() - t0
    if rss is not None:
        samples += 1; final_hwm = max(final_hwm, hwm or 0); final_rss = rss
        if samples % 100 == 0: tl.append((round(now, 2), rss))
        if hwm is not None and hwm > last_hwm and now - last_snap_t >= 0.003:
            try:
                with open(f'/proc/{pid}/smaps') as f: s = f.read()
                maps = parse_smaps(s)
                pm = read_pagemap(maps)
                rss2, hwm2 = status()
                last_hwm = hwm; last_snap_t = time.time() - t0
                cls0, _ = summarize(maps)
                events.append({'t': round(now, 3), 'vmrss': rss2, 'hwm': hwm2,
                               'heap': cls0.get('heap(brk)', {}).get('Rss', 0), 'anon': cls0.get('anon-mmap', {}).get('Rss', 0),
                               'code': cls0.get('main-binary:code(r-x)', {}).get('Rss', 0)})
                best = (maps, pm, rss2, hwm2); best_rss = rss2 or 0; best_t = round(now, 3)
                if sig:
                    try: os.kill(pid, getattr(signal, 'SIG' + sig))
                    except Exception: pass
            except Exception:
                pass
    time.sleep(0.002)

res = {'cmd': cmd, 'exit': p.returncode, 'peak_vmrss_kb': best_rss, 'peak_at_s': best_t, 'samples': samples,
       'timeline': tl[::max(1, len(tl) // 40)], 'final_hwm_seen_kb': final_hwm, 'peak_gap_kb': (final_hwm - best_rss) if best else None,
       'hwm_events': len(events), 'events': events[-60:]}
if best:
    maps, pm, rss2, hwm2 = best
    cls, libs = summarize(maps)
    res['classes'] = cls; res['libs'] = libs; res['sum_rss_kb'] = sum(v['Rss'] for v in cls.values())
    res['snap_vmrss_kb'] = rss2; res['snap_hwm_kb'] = hwm2
    top = sorted(maps, key=lambda m: -m['Rss'])[:25]
    res['mappings'] = [{'range': f"{m['start']:x}-{m['end']:x}", 'perms': m['perms'], 'name': m['name'] or '[anon]', 'class': classify(m), **{k: m[k] for k in FIELDS}} for m in top]
    # ---- resident text by function and origin
    try:
        binp = cmd[0]
        nm = subprocess.run(['nm', '-S', '--defined-only', '-n', binp], capture_output=True, text=True).stdout
        syms = []
        for l in nm.split('\n'):
            f = l.split()
            if len(f) == 4 and f[2] in 'TtWw':
                try: syms.append((int(f[0], 16), int(f[1], 16), f[3]))
                except Exception: pass
        exe_maps = [m for m in maps if os.path.basename(m['name']) == exe_base]
        if syms and exe_maps and pm:
            lowest = min(exe_maps, key=lambda m: m['start'])
            bias = 0 if syms[0][0] >= lowest['start'] else lowest['start'] - lowest['pgoff']
            symfile = {}
            sf = binp[:-4] + '.symfile.tsv' if binp.endswith('.bin') else binp + '.symfile.tsv'
            if os.path.exists(sf):
                for l in open(sf, encoding='utf8', errors='replace'):
                    a = l.rstrip('\n').split('\t')
                    if len(a) == 2: symfile[a[0]] = a[1]
            pkgcache = {}
            def origin(name, path):
                if path is None:
                    b = name.split('.', 1)[0]
                    if b.startswith('sc_f_') or b.startswith('sc_') : return 'generated-no-source(sc_*: walkers/thunks/shape helpers)' if not symfile else 'generated-no-source(sc_*: walkers/thunks/shape helpers)'
                    if b.startswith(('scr_', 'scrs_')): return 'runtime(scr_*)'
                    if b.startswith(('js_', 'JS_', 'lre_', 'lre', 'unicode_', 'cutils', 'dbuf_', 'bf_', 'libbf')): return 'quickjs-engine'
                    if b.startswith(('sqlite3', 'sqlite')): return 'sqlite'
                    if b.startswith(('mbedtls', 'psa_', 'mbed')): return 'mbedtls'
                    if b.startswith(('fe_', 'ge_', 'sc_reduce', 'scalarmult', 'ed25519', 'x25519', 'curve25519', 'crypto_')): return 'vendored-crypto'
                    if b.startswith(('inflate', 'deflate', 'zlib', 'adler', 'crc32', 'gz')): return 'zlib'
                    if b in ('main', '_start', 'frame_dummy', 'register_tm_clones', 'deregister_tm_clones', '__do_global_dtors_aux') or b.startswith('_'): return 'crt/libc-glue'
                    return 'other-exe-symbols'
                if 'zapo-rest-mysql' in path: return 'app(zapo-rest-mysql.ts)'
                m = re.search(r'/provenance/([0-9a-f]{40})/', path)
                if m: return 'zapo-js(provenance src)'
                m = re.search(r'/npm-trees/(sha512-[^/]+)/', path)
                if m:
                    root = path[:path.index(m.group(1)) + len(m.group(1))]
                    if root not in pkgcache:
                        try: pkgcache[root] = json.load(open(root + '/package.json')).get('name', '?')
                        except Exception: pkgcache[root] = '?'
                    return 'npm:' + pkgcache[root]
                m = re.search(r'node_modules/(@[^/]+/[^/]+|[^/]+)/', path)
                if m: return 'npm:' + m.group(1)
                return 'source-other:' + os.path.dirname(path)[-40:]
            pages = {}
            for (s0, e0, bm) in pm:
                for i, b in enumerate(bm):
                    if b: pages[(s0 + i * 4096)] = 1
            res_pages = len(pages)
            tot_pages = sum(len(bm) for (_, _, bm) in pm)
            by_origin = {}; funcs = []; attributed = 0
            for (a, sz, name) in syms:
                if sz <= 0: continue
                ra = a + bias; rb = ra + sz
                inx = [m for m in exe_maps if 'x' in m['perms'] and m['start'] <= ra < m['end']]
                if not inx: continue
                resb = 0
                pg = ra & ~4095
                while pg < rb:
                    if pg in pages:
                        resb += min(rb, pg + 4096) - max(ra, pg)
                    pg += 4096
                base = name.split('.', 1)[0]
                o = origin(name, symfile.get(base))
                d = by_origin.setdefault(o, {'functions': 0, 'bytes_total': 0, 'bytes_in_resident_pages': 0, 'functions_with_resident_page': 0})
                d['functions'] += 1; d['bytes_total'] += sz; d['bytes_in_resident_pages'] += resb
                if resb > 0:
                    d['functions_with_resident_page'] += 1; attributed += resb
                    funcs.append((sz, resb, name, o))
            funcs.sort(key=lambda r: -r[0])
            res['text_pages'] = {'resident': res_pages, 'mapped': tot_pages, 'resident_kb': res_pages * 4, 'bytes_attributed_to_symbols': attributed,
                                 'symbols_with_size': len(syms), 'symfile_entries': len(symfile), 'bias': bias}
            res['text_origin'] = dict(sorted(by_origin.items(), key=lambda kv: -kv[1]['bytes_in_resident_pages']))
            res['text_top30'] = [{'name': n, 'size': sz, 'bytes_in_resident_pages': rb, 'origin': o} for (sz, rb, n, o) in funcs[:30]]
    except Exception as e:
        res['text_error'] = repr(e)
json.dump(res, open(out, 'w'), indent=1)
print(out, 'exit', p.returncode, 'peak', best_rss, 'kB; final VmHWM seen', final_hwm, 'kB; events', len(events))
