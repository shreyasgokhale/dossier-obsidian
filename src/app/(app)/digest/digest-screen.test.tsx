import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { DigestView } from "@/lib/digest/view";
import { DigestScreen } from "./digest-screen";
import { runAgentNow, dismissAgentCandidate } from "../agent/actions";
import { savePostingForLater } from "../jobs/actions";
const nav = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  start: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/digest",
}));
vi.mock("@/hooks/use-job", () => ({ useJob: () => null }));
vi.mock("@/components/toast", () => ({
  toast: vi.fn(),
  toastResult: (r: unknown) => r,
}));
vi.mock("../agent/actions", () => ({
  runAgentNow: vi.fn(),
  dismissAgentCandidate: vi.fn(),
}));
vi.mock("../jobs/actions", () => ({ savePostingForLater: vi.fn() }));
vi.mock("../jobs/use-start-application", () => ({
  useStartApplication: () => ({ starting: null, start: nav.start }),
}));
const item = {
  id: "a",
  kind: "strong",
  posting: {
    source: "ARBEITNOW" as const,
    externalId: "a",
    title: "Senior Designer",
    company: "Demo Tools",
    place: "Berlin",
    remote: null,
    salary: "",
    postedAt: null,
    url: "https://jobs.example/a",
    via: "",
    description: "Figma",
    complete: true,
  },
  score: 90,
  reasons: ["Product design experience"],
  gaps: ["Salary unknown"],
  state: {
    postingId: null,
    saved: false,
    dismissed: false,
    applicationId: null,
    score: null,
  },
  dismissed: false,
};
const view: DigestView = {
  history: [
    {
      id: "d",
      at: "2026-10-31T08:00:00Z",
      label: "today at 09:00",
      demo: true,
    },
  ],
  digest: {
    id: "d",
    at: "2026-10-31T08:00:00Z",
    finished: true,
    demo: true,
    message: "1 strong match",
    sources: [{ source: "Arbeitnow", status: "ok", count: 1, message: "" }],
    items: [
      item,
      {
        ...item,
        id: "b",
        kind: "stretch",
        posting: { ...item.posting, title: "Lead Designer" },
        score: 60,
      },
      {
        ...item,
        id: "c",
        kind: "below",
        posting: { ...item.posting, title: "Other role" },
        score: 30,
      },
    ],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(savePostingForLater).mockResolvedValue({
    ok: true,
    data: { postingId: "p" },
  });
  vi.mocked(dismissAgentCandidate).mockResolvedValue({
    ok: true,
    data: { undo: null },
  });
  vi.mocked(runAgentNow).mockResolvedValue({
    ok: true,
    data: { jobId: "j", reused: false },
  });
});
it("distinguishes demo matches and stretches, shows gaps, and connects explicit actions", async () => {
  const user = userEvent.setup();
  render(<DigestScreen view={view} configured enabled runJobId={null} />);
  expect(
    screen.getByRole("heading", { name: "DEMO — synthetic results" }),
  ).toBeVisible();
  expect(screen.getByText(/not live vacancies/)).toBeVisible();
  expect(screen.queryByText("Other role")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: /Show 1 lower matches/ }),
  );
  expect(screen.getByText("Other role")).toBeVisible();
  await user.click(screen.getAllByRole("button", { name: "Save" })[0]);
  expect(savePostingForLater).toHaveBeenCalledWith({ posting: item.posting });
  await user.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);
  expect(dismissAgentCandidate).toHaveBeenCalledWith({ candidateId: "a" });
  await user.click(
    screen.getAllByRole("button", { name: "Start application" })[0],
  );
  expect(nav.start).toHaveBeenCalledWith(item.posting, "a");
  await user.click(screen.getByRole("button", { name: "Run now" }));
  expect(runAgentNow).toHaveBeenCalled();
});
it("provides setup guidance, and keeps dismissed or pursued jobs out of cards", () => {
  const { unmount } = render(
    <DigestScreen
      view={{ history: [], digest: null }}
      configured={false}
      enabled={false}
      runJobId={null}
    />,
  );
  expect(screen.getByText(/Set up Search Preferences/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Run now" })).toBeDisabled();
  unmount();
  render(
    <DigestScreen
      view={{
        ...view,
        digest: {
          ...view.digest!,
          demo: false,
          items: [
            { ...item, dismissed: true },
            {
              ...item,
              id: "x",
              state: { ...item.state, applicationId: "app" },
            },
          ],
        },
      }}
      configured
      enabled
      runJobId="running"
    />,
  );
  expect(screen.queryByText("Demo Tools")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Starting discovery");
});
