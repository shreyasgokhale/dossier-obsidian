import { contentDisposition } from "@/lib/file-name";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/route";

export const GET = route<RouteContext<"/api/applications/[id]/evidence/[entry]">>(async (_request, { params }) => {
  const { id, entry } = await params;
  const item = await prisma.applicationEvidence.findUnique({
    where: { id: entry, applicationId: id },
    select: { fileName: true, fileContent: true },
  });
  if (!item?.fileName || !item.fileContent) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(Buffer.from(item.fileContent, "base64")), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": contentDisposition(item.fileName),
    },
  });
});
