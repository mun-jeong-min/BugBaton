import assert from "node:assert/strict";
import test from "node:test";
import { commandHint, parseArgs } from "../src/args.js";

test("parses a command with global flags on either side", () => {
  assert.deepEqual(parseArgs(["--json", "snapshot", "--tab", "abc"]).options, { json: true, tab: "abc" });
  assert.deepEqual(parseArgs(["snapshot", "--tab", "abc", "--json"]).options, { tab: "abc", json: true });
});

test("supports version and verbose without conflating them", () => {
  assert.equal(parseArgs(["--version"]).topVersion, true);
  assert.equal(parseArgs(["tabs", "-v"]).options.v, true);
  assert.equal(parseArgs(["tabs", "-v"]).topVersion, false);
});

test("rejects duplicate, unknown, and missing-value options", () => {
  assert.throws(() => parseArgs(["tabs", "--json", "--json"]), /Duplicate option/);
  assert.throws(() => parseArgs(["tabs", "--wat"]), /Unknown option/);
  assert.throws(() => parseArgs(["snapshot", "--tab"]), /requires a value/);
});

test("subcommand help is a read-only parser result", () => {
  const parsed = parseArgs(["launch", "--help"]);
  assert.equal(parsed.command, "launch");
  assert.equal(parsed.help, true);
});

test("fill accepts a boolean stdin mode without treating it as a value", () => {
  const parsed = parseArgs(["fill", "@e1", "--stdin", "--tab", "abc"]);
  assert.equal(parsed.options.stdin, true);
  assert.equal(parsed.options.tab, "abc");
  assert.deepEqual(parsed.positionals, ["@e1"]);
});

test("known command remains identifiable when strict parsing fails", () => {
  assert.equal(commandHint(["--json", "snapshot", "--wat"]), "snapshot");
  assert.equal(commandHint(["mystery", "--json"]), null);
});

test("double dash permits positional values that begin with a dash", () => {
  const parsed = parseArgs(["fill", "@e1", "--tab", "abc", "--", "-draft"]);
  assert.deepEqual(parsed.positionals, ["@e1", "-draft"]);
  assert.equal(parsed.options.tab, "abc");
});

test("capture accepts one-command recording options", () => {
  const parsed = parseArgs(["capture", "--url", "http://127.0.0.1:3000", "--duration", "5", "--output", "bug-report", "--title", "Checkout fails"]);
  assert.equal(parsed.command, "capture");
  assert.deepEqual(parsed.options, { url: "http://127.0.0.1:3000", duration: "5", output: "bug-report", title: "Checkout fails" });
});
