import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { PreferencesEditor } from "./preferences-editor";
import {
  savePreferences,
  resolvePreferences,
  reconcilePreferences,
} from "./actions";
import { DEFAULT_PREFERENCES } from "@/lib/digest/preferences";
import type { preferenceView } from "@/lib/markdown/search-preferences";
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/search-preferences",
}));
vi.mock("@/components/toast", () => ({
  toast: vi.fn(),
  toastResult: (r: unknown) => r,
}));
vi.mock("./actions", () => ({
  savePreferences: vi.fn(),
  resolvePreferences: vi.fn(),
  reconcilePreferences: vi.fn(),
}));
const view: Awaited<ReturnType<typeof preferenceView>> = {
  preferences: DEFAULT_PREFERENCES,
  revision: "rev",
  enabled: false,
  hour: 7,
  markdown: true,
  error: null,
  conflict: null,
  conflictToken: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(savePreferences).mockResolvedValue({ ok: true, data: null });
  vi.mocked(resolvePreferences).mockResolvedValue({ ok: true, data: null });
  vi.mocked(reconcilePreferences).mockResolvedValue({ ok: true, data: null });
});
it("edits search intent, sources and scheduling independently and parses board metadata without AI", async () => {
  const user = userEvent.setup();
  render(<PreferencesEditor view={view} />);
  await user.clear(screen.getByLabelText(/^Target roles/));
  await user.type(screen.getByLabelText(/^Target roles/), "Product Designer");
  await user.selectOptions(
    screen.getByLabelText("Remote preference"),
    "preferred",
  );
  await user.type(screen.getByLabelText(/^Interests/), "Climate tools");
  await user.type(screen.getByLabelText(/^Exclusions/), "Agency");
  await user.click(screen.getByLabelText(/Company career boardsPublic API/));
  await user.type(
    screen.getByLabelText(/^Company boards/),
    "Demo Studio | greenhouse | demo",
  );
  await user.click(screen.getByLabelText("Enable daily digest"));
  await user.click(
    screen.getByRole("button", { name: "Save Search Preferences" }),
  );
  expect(savePreferences).toHaveBeenCalledWith(
    expect.objectContaining({
      expected: "rev",
      enabled: true,
      hour: 7,
      preferences: expect.objectContaining({
        roles: ["Product Designer"],
        remote: "preferred",
        exclusions: ["Agency"],
        interests: ["Climate tools"],
        boards: [{ name: "Demo Studio", provider: "greenhouse", slug: "demo" }],
      }),
    }),
  );
  await user.click(screen.getByRole("button", { name: "Sync Markdown now" }));
  expect(reconcilePreferences).toHaveBeenCalled();
});
it("shows both conflict versions, prevents saving over a conflict, and sends the review token", async () => {
  const user = userEvent.setup();
  render(
    <PreferencesEditor
      view={{
        ...view,
        error: "Concurrent edits",
        conflict: {
          app: DEFAULT_PREFERENCES,
          file: { ...DEFAULT_PREFERENCES, interests: ["Energy"] },
          fileHash: "hash",
        },
        conflictToken: "review",
      }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Concurrent edits");
  expect(
    screen.getByRole("button", { name: "Save Search Preferences" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Keep Markdown" }));
  expect(resolvePreferences).toHaveBeenCalledWith({
    choice: "file",
    expected: "review",
  });
});
it("rejects incomplete source configuration before any mutation", async () => {
  const user = userEvent.setup();
  render(<PreferencesEditor view={view} />);
  await user.clear(screen.getByLabelText(/^Target roles/));
  await user.click(
    screen.getByRole("button", { name: "Save Search Preferences" }),
  );
  expect(savePreferences).not.toHaveBeenCalled();
});
