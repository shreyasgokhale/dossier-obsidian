import { loadDigestView } from "@/lib/digest/view";
import { loadSettings } from "@/lib/settings-data";
import { findUnfinishedJobs } from "@/lib/jobs/runner";
import { DigestScreen } from "./digest-screen";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const [{ id }, settings, jobs] = await Promise.all([
    searchParams,
    loadSettings(),
    findUnfinishedJobs("agent"),
  ]);
  return (
    <DigestScreen
      view={await loadDigestView(id)}
      configured={!!settings.searchPreferences}
      enabled={settings.agentEnabled}
      runJobId={jobs[0]?.id ?? null}
    />
  );
}
