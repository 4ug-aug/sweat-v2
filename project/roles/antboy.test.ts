import { expect, test } from "bun:test";
import { antboyRole } from "./antboy";
import { WEB_TOOL_INSTRUCTIONS } from "./web";

test("antboy searches Outline with list_documents and reads with fetch", () => {
  expect(antboyRole.instructions).toContain("outline.list_documents");
  expect(antboyRole.instructions).toContain("outline.fetch");
  expect(antboyRole.instructions).toContain('resource "document"');
  expect(antboyRole.instructions).toContain(WEB_TOOL_INSTRUCTIONS);
});
