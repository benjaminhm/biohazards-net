import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { resolveCobidSession } from "@/lib/cobid/session";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const BUCKET = "cobid-files";

export async function POST(req: NextRequest) {
  try {
    const session = await resolveCobidSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.roleType === "client") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Only JPG, PNG, WebP, GIF, and PDF files are supported" },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File exceeds 10 MB limit" },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueName = `${crypto.randomUUID().slice(0, 8)}-${safeName}`;
    const storagePath = `${session.orgId}/${uniqueName}`;

    const supabase = createServiceClient();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (error) {
      console.error("Supabase upload error:", error);
      return NextResponse.json({ error: "Storage upload failed" }, { status: 500 });
    }

    return NextResponse.json({
      url: `/api/cobid/files?path=${encodeURIComponent(storagePath)}`,
      filename: file.name,
      mimeType: file.type,
    });
  } catch (err) {
    console.error("POST /api/cobid/uploads error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
