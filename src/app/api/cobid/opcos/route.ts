import { NextRequest, NextResponse } from "next/server";
import { resolveCobidSession } from "@/lib/cobid/session";
import {
  archiveDirectoryOpCo,
  listDirectoryOpCos,
  upsertDirectoryOpCo,
} from "@/lib/cobid/store";

export async function GET(req: NextRequest) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.roleType !== "coordinator") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const opCos = await listDirectoryOpCos(session.orgId);
    return NextResponse.json({ opCos });
  } catch (err) {
    console.error("GET /api/cobid/opcos error:", err);
    return NextResponse.json({ error: "Failed to load OpCo directory" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.roleType !== "coordinator") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    if (!body?.companyName?.trim() || !body?.tradeCategory?.trim()) {
      return NextResponse.json(
        { error: "companyName and tradeCategory are required" },
        { status: 400 }
      );
    }

    const opCo = await upsertDirectoryOpCo(session.orgId, body);
    return NextResponse.json({ opCo }, { status: 201 });
  } catch (err) {
    console.error("POST /api/cobid/opcos error:", err);
    return NextResponse.json({ error: "Failed to save OpCo" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.roleType !== "coordinator") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await archiveDirectoryOpCo(session.orgId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/cobid/opcos error:", err);
    return NextResponse.json({ error: "Failed to archive OpCo" }, { status: 500 });
  }
}
