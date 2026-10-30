"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { action, ActionError } from "@/lib/action";
import { parseDate } from "@/lib/markdown/format";
import { prisma } from "@/lib/prisma";
const day = z.string().refine((s) => { if (!s) return true; try { return parseDate(s, "YYYY-MM-DD") === s; } catch { return false; } }, "Use a valid ISO calendar date.");
export const saveTracking = action(z.object({ id: z.string().min(1), values: z.object({ applicationDate: day, followUpDate: day, deadline: day, nextAction: z.string().max(2000), company: z.string().max(500), role: z.string().max(500), postingUrl: z.string().refine((s) => !s || /^https?:\/\/\S+$/.test(s), "Use an HTTP(S) posting URL."), location: z.string().max(500) }) }), async ({ id, values }) => {
  const { applicationDate, followUpDate, deadline, ...text } = values;
  const date = (s: string) => s ? new Date(`${s}T00:00:00Z`) : null;
  const { count } = await prisma.application.updateMany({ where: { id }, data: { ...text, applicationDate: date(applicationDate), followUpDate: date(followUpDate), deadline: date(deadline) } });
  if (!count) throw new ActionError("That application no longer exists.");
  revalidatePath("/", "layout"); return null;
});
