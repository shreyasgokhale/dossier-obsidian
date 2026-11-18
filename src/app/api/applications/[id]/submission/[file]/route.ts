import { contentDisposition } from "@/lib/file-name";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/route";
import { submittedFilesSchema } from "@/lib/submission-data";

export const GET = route<RouteContext<"/api/applications/[id]/submission/[file]">>(async (_request, { params }) => {
  const { id, file } = await params;
  if (!/^(0|[1-9][0-9]*)$/.test(file)) return new Response(null, { status: 404 });
  const submission = await prisma.applicationSubmission.findUnique({ where: { applicationId: id }, select: { files: true } });
  const parsed = submittedFilesSchema.safeParse(submission?.files);
  const artifact = parsed.success ? parsed.data[Number(file)] : undefined;
  if (!artifact) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(Buffer.from(artifact.content, "base64")), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": contentDisposition(artifact.name),
    },
  });
});
