And it **reaches a binary**:

```
BUILD rc=0  703s   LOG-SITES total=0    (no `N errors.` line -- there were none)
BINARY bytes=28,903,424       RUN exit=0  stdout=264B
ORACLE node v25.9.0 exit=0    ORACLE: MATCH (byte-exact)
provenance: zapo-js@1.8.2 <- refs/tags/v1.8.2 @ 757a8071b819 (source compiles statically)
```

The binary constructs all sixteen SQLite store domains against a `:memory:`
database and prints `auth=object … messageSecret=object`, byte-identical to the
same driver under node. Its emitted C is 16 translation units,
**140,994,112 bytes**, carrying exactly **one** runtime fence -- the same
`[SC2020 at …/spec/proto/index.js:1]` `require()` site every program in this
survey carries.
