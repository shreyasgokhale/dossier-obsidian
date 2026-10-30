import { expect, it, vi } from "vitest";
vi.mock("./service", () => ({ locked: vi.fn() }));
vi.mock("@/lib/settings-data", () => ({
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
}));
import {
  parsePreferencesNote,
  writePreferencesNote,
} from "./search-preferences";
import { DEFAULT_PREFERENCES } from "@/lib/digest/preferences";
it("round trips deterministic YAML and preserves body, comments and unknown keys", () => {
  const text =
    writePreferencesNote(null, DEFAULT_PREFERENCES).replace(
      "roles:",
      "# keep my comment\ncustom: untouched\nroles:",
    ) + "\nMy private planning notes.\n";
  const edited = writePreferencesNote(text, {
    ...DEFAULT_PREFERENCES,
    interests: ["Energy"],
  });
  expect(edited).toContain("# keep my comment");
  expect(edited).toContain("custom: untouched");
  expect(edited).toContain("My private planning notes.");
  expect(parsePreferencesNote(edited).preferences.interests).toEqual([
    "Energy",
  ]);
});
it("rejects duplicate keys, aliases and invalid metadata without AI", () => {
  expect(() => parsePreferencesNote("not frontmatter")).toThrow(/frontmatter/);
  expect(() =>
    parsePreferencesNote("---\nroles: [A]\nroles: [B]\n---\n"),
  ).toThrow(/YAML/);
  expect(() => parsePreferencesNote("---\nroles: []\n---\n")).toThrow();
});
