import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startMarkdownWorker } from "./worker";
import { reconcile } from "./service";
import { syncDocuments, exportObsidian } from "./documents";
import { watch } from "node:fs";
import { logServerError } from "@/lib/log";
vi.mock("./service", () => ({ reconcile: vi.fn(async () => ({ linked: 1 })) }));
vi.mock("./documents", () => ({ syncDocuments: vi.fn(async () => {}), exportObsidian: vi.fn(async () => {}) }));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
const watcher = vi.hoisted(() => ({ change: null as null | ((event: string, file: string) => void), error: null as null | ((e: Error) => void) }));
vi.mock("node:fs", () => ({ watch: vi.fn((_root, _options, callback) => { watcher.change = callback; return { unref: vi.fn(), on: (_name: string, listener: (e: Error) => void) => watcher.error = listener }; }) }));
const globalState = globalThis as unknown as { markdownWorker?: { timer: NodeJS.Timeout; debounce?: NodeJS.Timeout } };
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); delete globalState.markdownWorker; vi.stubEnv("DOSSIER_NOTES_ROOT", "/synthetic/notes"); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); delete globalState.markdownWorker; });
it("reconciles at startup, on note edits and every 15 seconds without duplicate workers", async () => {
  startMarkdownWorker(); startMarkdownWorker(); await vi.advanceTimersByTimeAsync(0);
  expect(reconcile).toHaveBeenCalledTimes(1); expect(watch).toHaveBeenCalledTimes(1); expect(syncDocuments).toHaveBeenCalledTimes(1); expect(exportObsidian).toHaveBeenCalledTimes(1);
  watcher.change!("change", "note.md"); watcher.change!("change", "note.md"); await vi.advanceTimersByTimeAsync(301); expect(reconcile).toHaveBeenCalledTimes(2);
  watcher.change!("change", "Dossier/Dashboard.md"); watcher.change!("change", "note.tmp"); await vi.advanceTimersByTimeAsync(15_000); expect(reconcile).toHaveBeenCalledTimes(3);
  watcher.error!(new Error("watcher disconnected")); expect(logServerError).toHaveBeenCalled();
});
it("keeps periodic reconciliation after unsupported watchers and recovers from failures", async () => {
  vi.mocked(watch).mockImplementationOnce(() => { throw new Error("unsupported"); });
  vi.mocked(reconcile).mockRejectedValueOnce(new Error("offline"));
  startMarkdownWorker(); await vi.advanceTimersByTimeAsync(0); expect(logServerError).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(15_000); expect(exportObsidian).toHaveBeenCalledTimes(1);
});
it("does no work when integration is disabled and prevents overlapping ticks", async () => {
  vi.stubEnv("DOSSIER_NOTES_ROOT", ""); startMarkdownWorker(); expect(reconcile).not.toHaveBeenCalled();
  vi.stubEnv("DOSSIER_NOTES_ROOT", "/synthetic/notes"); let finish!: () => void;
  vi.mocked(reconcile).mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ linked: 1 }); }));
  startMarkdownWorker(); await vi.advanceTimersByTimeAsync(30_000); expect(reconcile).toHaveBeenCalledTimes(1);
  finish(); await vi.advanceTimersByTimeAsync(15_000); expect(reconcile).toHaveBeenCalledTimes(2);
});
