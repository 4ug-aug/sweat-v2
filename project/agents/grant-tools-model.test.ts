import { expect, test } from "bun:test";
import { createOpenAIGrantPicker, parsePickedNames } from "./grant-tools-model";

const model = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "test-key",
  model: "test-model",
};

test("parsePickedNames accepts names and drops unknown ids", () => {
  expect(
    parsePickedNames(
      '{"names":["workspace.get_issue","nope"]}',
      ["workspace.get_issue"],
    ),
  ).toEqual(["workspace.get_issue"]);
  expect(
    parsePickedNames(
      'Sure.\n{"names":["github.compare"]}',
      ["github.compare"],
    ),
  ).toEqual(["github.compare"]);
});

test("parsePickedNames rejects the tools alias", () => {
  expect(() =>
    parsePickedNames('{"tools":["github.compare"]}', ["github.compare"]),
  ).toThrow("Grant picker returned invalid JSON");
});

test("OpenAI grant picker calls the SDK path with no tools", async () => {
  let seen: {
    model: { model: string };
    messages: readonly { role: string; content: string }[];
  } | undefined;
  const pick = createOpenAIGrantPicker(() => model, async (input) => {
    seen = input;
    return '{"names":["workspace.get_issue"]}';
  });
  const names = await pick({
    task: "read COL-123",
    names: ["workspace.get_issue", "github.compare"],
    listing: "workspace.get_issue: Get issues\ngithub.compare: Compare refs",
  });
  expect(names).toEqual(["workspace.get_issue"]);
  expect(seen?.model.model).toBe("test-model");
  expect(seen?.messages).toHaveLength(2);
  expect(seen?.messages[0]?.content).toContain("You have no tools");
  expect(seen).not.toHaveProperty("tools");
});

test("grant picker source uses json_object only and does not import zod", async () => {
  const source = await Bun.file(new URL("./grant-tools-model.ts", import.meta.url)).text();
  expect(source).not.toContain('from "zod"');
  expect(source).not.toContain("json_schema");
  expect(source).toContain('type: "json_object"');
});
