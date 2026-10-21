import { expect, test } from "vitest";
import { sandboxRunnerConfig } from "../../scripts/sandbox-config.mjs";

test("runner settings are read after loading the sandbox environment", () => {
  expect(
    sandboxRunnerConfig({
      SCRIPTC_SANDBOX_VCPUS: "16",
      SCRIPTC_TEST_WORKERS: "7",
      SCRIPTC_LOCAL_TEST_WORKERS: "3",
      SCRIPTC_LOCAL_CASE_SHARDS: "4",
      SCRIPTC_SANDBOX_TIMEOUT: "90m",
    }),
  ).toEqual({
    vcpus: "16",
    testWorkers: "7",
    localTestWorkers: "3",
    localCaseShards: "4",
    sandboxTimeout: "90m",
    sandboxTimeoutMs: 5_400_000,
  });
});

test("runner settings retain their documented defaults", () => {
  expect(sandboxRunnerConfig({})).toEqual({
    vcpus: "8",
    testWorkers: "4",
    localTestWorkers: "2",
    localCaseShards: "2",
    sandboxTimeout: "45m",
    sandboxTimeoutMs: 2_700_000,
  });
});
