
**Why all three land on exactly 46, to the site.** It is a shared shape plus a
shared scaffold, and `harness/why46.mjs` decomposes it identically for each:

```
store-mysql     total= 46  = zapo-js core 7 + own 19 + driver 20
store-postgres  total= 46  = zapo-js core 7 + own 19 + driver 20
store-redis     total= 46  = zapo-js core 7 + own 19 + driver 20
store-sqlite    total=  7  = zapo-js core 7 + own  0 + driver  0

  own    16x  SC1090  extending classes not declared in the program ('Base*Store')
         1x  SC2013  importing 'ioredis' / 'pg' / 'mysql2' requires the engine
         1x  SC2013  values from that package run in the engine
         1x  SC2011  the package's own Wa*StoreConfig / Wa*StoreResult
  driver 19x  SC2004  one per console.log line that uses the failed local
         1x  SC2011  the factory's result type
```

The **7** is the zapo-js-core cluster, identical site-for-site in all five
(§5, "one fix, not five"). The **16** is one per store class extending a base
that imports the islanded database driver, and all three packages implement the
same sixteen domains. The **20** is mine: `harness/gen-drivers.mjs` emits all
five store drivers from one template with nineteen `console.log` lines, so the
cascade off a failed factory call is nineteen sites in every one of them.

So 46 is not a coincidence and it is not one number: **only 19 of the 46 are the
package's own code**, and 16 of those 19 are a single cause.

