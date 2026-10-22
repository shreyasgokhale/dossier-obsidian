import "server-only";
import { watch, type FSWatcher } from "node:fs";
import { logServerError } from "@/lib/log";
import { reconcile } from "./service";
import { syncDocuments, exportObsidian } from "./documents";
const state = globalThis as unknown as {
  markdownWorker?: {
    timer: NodeJS.Timeout;
    watcher?: FSWatcher;
    busy: boolean;
    debounce?: NodeJS.Timeout;
  };
};
export function startMarkdownWorker() {
  if (!process.env.DOSSIER_NOTES_ROOT || state.markdownWorker) return;
  async function tick() {
    const worker = state.markdownWorker!;
    if (worker.busy) return;
    worker.busy = true;
    try {
      await reconcile();
      await syncDocuments();
      await exportObsidian();
    } catch (error) {
      logServerError("markdown reconciliation", error);
    } finally {
      worker.busy = false;
    }
  }
  const timer = setInterval(() => void tick(), 15_000);
  timer.unref();
  state.markdownWorker = { timer, busy: false };
  try {
    const watcher = watch(
      process.env.DOSSIER_NOTES_ROOT,
      { recursive: true },
      (_, file) => {
        if (!file?.endsWith(".md") || file.startsWith("Dossier/")) return;
        if (state.markdownWorker?.debounce)
          clearTimeout(state.markdownWorker.debounce);
        state.markdownWorker!.debounce = setTimeout(() => void tick(), 300);
      },
    );
    watcher.unref();
    state.markdownWorker.watcher = watcher;
    watcher.on("error", (e) =>
      logServerError(
        "markdown watcher; periodic reconciliation remains active",
        e,
      ),
    );
  } catch (error) {
    logServerError(
      "markdown watcher; periodic reconciliation remains active",
      error,
    );
  }
  void tick();
}
