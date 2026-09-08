# Install deps and build the compiler in the mongodriver worktree.
# Install + build under node v22.18.0 (v25's pnpm purges v22's node_modules and
# it reads as a red gate); every ANALYSIS afterwards runs under v25.9.0.
. <blocks>\mongodriver\lab\env.ps1
$env:PATH = "<home>\AppData\Local\nvm\v22.18.0;" + $env:PATH
$log = "<blocks>\mongodriver\lab\build-compiler.log"
"BUILD-NODE $(node --version)" | Out-File -Encoding utf8 $log
"PNPM $(pnpm --version)" | Out-File -Append -Encoding utf8 $log
"ZIG $(zig version) @ $((Get-Command zig).Source)" | Out-File -Append -Encoding utf8 $log
"TAR $((Get-Command tar).Source)" | Out-File -Append -Encoding utf8 $log
"HEAD $(git -C <blocks>\mongodriver\wt rev-parse HEAD)" | Out-File -Append -Encoding utf8 $log
Set-Location <blocks>\mongodriver\wt
pnpm install --frozen-lockfile *>&1 | Out-File -Append -Encoding utf8 $log
"=== INSTALL-EXIT rc=$LASTEXITCODE ===" | Out-File -Append -Encoding utf8 $log
pnpm build *>&1 | Out-File -Append -Encoding utf8 $log
"=== BUILD-EXIT rc=$LASTEXITCODE ===" | Out-File -Append -Encoding utf8 $log
"C-FALLBACK-AFTER-BUILD $(Test-Path '<home>\.cache\scriptc')" | Out-File -Append -Encoding utf8 $log
"=== GATE-EXIT sentinel: build-compiler done ===" | Out-File -Append -Encoding utf8 $log
