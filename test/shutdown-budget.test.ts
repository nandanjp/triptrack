import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DRAIN_DELAY_MS, SHUTDOWN_TIMEOUT_MS } from "../src/config.ts";

/**
 * The chart grants a grace period; the application spends it. If the code's
 * budget ever exceeds the chart's, the kubelet kills the process mid-request —
 * so the two are asserted against each other rather than kept in sync by hand.
 */
test("the shutdown budget fits inside the chart's grace period", () => {
  const values = readFileSync("charts/triptrack/values.yaml", "utf8");
  const match = /^\s*terminationGracePeriodSeconds:\s*(\d+)\s*$/m.exec(values);

  assert.ok(match, "terminationGracePeriodSeconds not found in the chart");
  const graceMs = Number(match[1]) * 1000;

  assert.ok(
    DRAIN_DELAY_MS + SHUTDOWN_TIMEOUT_MS < graceMs,
    `drain ${DRAIN_DELAY_MS}ms + shutdown ${SHUTDOWN_TIMEOUT_MS}ms must be under grace ${graceMs}ms`,
  );
});
