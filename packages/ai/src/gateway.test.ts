import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSummaryAndActions } from "./gateway.js";

test("parseSummaryAndActions splits summary from bulleted actions", () => {
  const out = parseSummaryAndActions(
    "Alice sent a meeting recap.\nThe Q3 launch is on track.\n\n- Review the Figma links before Friday\n- Reply to Bob about budget\n- Ship the dashboard by EOD"
  );
  assert.match(out.summary, /meeting recap/);
  assert.equal(out.actionItems.length, 3);
  assert.match(out.actionItems[0], /Figma/);
});

test("parseSummaryAndActions handles numeric bullets", () => {
  const out = parseSummaryAndActions("Summary here.\n1. Do thing one\n2. Do thing two");
  assert.equal(out.actionItems.length, 2);
});

test("parseSummaryAndActions returns empty actions when none", () => {
  const out = parseSummaryAndActions("Just a heads-up, no action needed.");
  assert.equal(out.actionItems.length, 0);
  assert.match(out.summary, /heads-up/);
});
