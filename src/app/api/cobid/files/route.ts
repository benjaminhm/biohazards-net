import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { resolveCobidSession } from "@/lib/cobid/session";

const BUCKET = "cobid-files";

export async function GET(req: NextRequest) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const filePath = req.nextUrl.searchParams.get("path") || "";
    if (!filePath || filePath.includes("..") || !filePath.startsWith(`${session.orgId}/`)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase.storage.from(BUCKET).download(filePath);

    if (error || !data) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const arrayBuffer = await data.arrayBuffer();
    return new NextResponse(Buffer.from(arrayBuffer), {
      status: 200,
      headers: {
        "Content-Type": data.type || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("GET /api/cobid/files error:", err);
    return NextResponse.json({ error: "Failed to load file" }, { status: 500 });
  }
}
