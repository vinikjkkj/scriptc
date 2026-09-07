
> **What lane this table is, exactly.** Each driver imports **only its own
> package** by bare specifier. For the five store packages that matters: because
> the driver never names `zapo-js`, `zapo-js` is not a driver-level mapped
> package, and every `zapo-js*` specifier inside the store package's source is
> answered by the store package's **own attested v1.8.0 checkout** through that
> checkout's tsconfig alias `zapo-js -> src`. A real consumer imports both, gets
> zapo-js 1.8.2, and gets different numbers. **§5c is that comparison**, and it
> is the row to read for "does this package work for me". This table is kept
> because it is what a package's own attestation reaches on its own, which is a
> true and load-bearing fact about the published artifact.

