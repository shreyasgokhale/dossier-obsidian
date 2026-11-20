import { preferenceView } from "@/lib/markdown/search-preferences";
import { PreferencesEditor } from "./preferences-editor";
export default async function Page() {
  const view = await preferenceView();
  return (
    <PreferencesEditor
      key={view.revision + (view.conflictToken ?? "")}
      view={view}
    />
  );
}
