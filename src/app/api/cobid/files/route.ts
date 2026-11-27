import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { resolveCobidSession } from "@/lib/cobid/session";
import { getOpCoByOnboardingToken, hashCobidToken } from "@/lib/cobid/store";

const BUCKET = "cobid-files";

export async function GET(req: NextRequest) {
  try {
    const filePath = req.nextUrl.searchParams.get("path") || "";
    const onboardingToken = req.nextUrl.searchParams.get("onboardingToken") || "";
    const docToken = req.nextUrl.searchParams.get("docToken") || "";

    if (!filePath || filePath.includes("..")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = createServiceClient();
    let authorized = false;

    if (onboardingToken) {
      const found = await getOpCoByOnboardingToken(onboardingToken);
      if (found && !found.expired) {
        const prefix = `${found.orgId}/opcos/${found.opCo.id}/`;
        if (filePath.startsWith(prefix)) {
          authorized = true;
        }
      }
    } else if (docToken) {
      const hash = hashCobidToken(docToken);
      const { data: scope } = await supabase
        .from("cobid_scopes")
        .select("org_id, directory_opco_id")
        .eq("doc_token_hash", hash)
        .maybeSingle();

      if (scope?.org_id && scope?.directory_opco_id) {
        const prefix = `${scope.org_id}/opcos/${scope.directory_opco_id}/`;
        if (filePath.startsWith(prefix)) {
          authorized = true;
        }
      }
    } else {
      const session = await resolveCobidSession(req);
      if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (filePath.startsWith(`${session.orgId}/`)) {
        authorized = true;
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
