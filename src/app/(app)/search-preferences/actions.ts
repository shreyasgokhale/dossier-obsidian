"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { action, ActionError } from "@/lib/action";
import { searchPreferencesSchema } from "@/lib/digest/preferences";
import {
  saveSearchPreferences,
  resolvePreferenceConflict,
  syncSearchPreferences,
} from "@/lib/markdown/search-preferences";
import { saveSettings } from "@/lib/settings-data";
import { MarkdownError } from "@/lib/markdown/format";
const handled = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (e) {
    if (e instanceof MarkdownError) throw new ActionError(e.message);
    throw e;
  }
  revalidatePath("/search-preferences");
  revalidatePath("/digest");
  revalidatePath("/agent");
  return null;
};
export const savePreferences = action(
  z.object({
    preferences: searchPreferencesSchema,
    expected: z.string(),
    enabled: z.boolean(),
    hour: z.number().int().min(0).max(23),
  }),
  async ({ preferences, expected, enabled, hour }) =>
    handled(async () => {
      await saveSearchPreferences(preferences, expected);
      await saveSettings({ agentEnabled: enabled, agentHour: hour });
    }),
);
export const resolvePreferences = action(
  z.object({ choice: z.enum(["app", "file"]), expected: z.string() }),
  ({ choice, expected }) =>
    handled(() => resolvePreferenceConflict(choice, expected)),
);
export const reconcilePreferences = action(z.object({}), () =>
  handled(() => syncSearchPreferences()),
);
