import type { ApplicationEvidenceKind, ApplicationStatus } from "@/generated/prisma/enums";
import { formatShortDate } from "@/lib/dates";

// An application's private notes, status changes and follow-up evidence,
// newest first. Dates are formatted here, on the server.

export type ActivityEntry =
  | { kind: "note"; id: string; body: string; date: string; edited: boolean }
  | { kind: "status"; id: string; status: ApplicationStatus; date: string }
  | { kind: "evidence"; id: string; evidenceKind: ApplicationEvidenceKind; date: string }
  | { kind: "created"; id: "created"; date: string };

/** Saving a new note sets both times a moment apart; only a later save counts as an edit. */
const EDIT_AFTER_MS = 2000;

export function activityTimeline({
  notes,
  events,
  evidence = [],
  createdAt,
  now = new Date(),
}: {
  notes: { id: string; body: string; createdAt: Date; updatedAt: Date }[];
  events: { id: string; to: ApplicationStatus; at: Date }[];
  evidence?: { id: string; kind: ApplicationEvidenceKind; createdAt: Date; occurredAt: Date | null }[];
  createdAt: Date;
  now?: Date;
}): ActivityEntry[] {
  const dated: { at: Date; entry: ActivityEntry }[] = [
    ...notes.map((note) => ({
      at: note.createdAt,
      entry: {
        kind: "note" as const,
        id: note.id,
        body: note.body,
        date: formatShortDate(note.createdAt, now),
        edited: note.updatedAt.getTime() - note.createdAt.getTime() > EDIT_AFTER_MS,
      },
    })),
    ...events.map((event) => ({
      at: event.at,
      entry: { kind: "status" as const, id: event.id, status: event.to, date: formatShortDate(event.at, now) },
    })),
    ...evidence.map((item) => {
      const at = item.occurredAt ?? item.createdAt;
      return { at, entry: { kind: "evidence" as const, id: item.id, evidenceKind: item.kind, date: formatShortDate(at, now) } };
    }),
    { at: createdAt, entry: { kind: "created" as const, id: "created" as const, date: formatShortDate(createdAt, now) } },
  ];
  // Newest first, including evidence from before the application was created here.
  return dated
    .sort((a, b) => (b.at.getTime() - a.at.getTime()))
    .map(({ entry }) => entry);
}
