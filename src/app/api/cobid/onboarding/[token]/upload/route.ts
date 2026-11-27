import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getOpCoByOnboardingToken } from "@/lib/cobid/store";

const ALLOWED_DOC_TYPES = new Set([
  "public_liability",
  "workcover",
  "trade_licence",
  "hazmat_licence",
  "swms",
  "other",
]);

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_BYTES = 12 * 1024 * 1024;
const BUCKET = "cobid-files";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const found = await getOpCoByOnboardingToken(token);
    if (!found) {
      return NextResponse.json({ error: "Onboarding link not found" }, { status: 404 });
    }
    if (found.expired) {
      return NextResponse.json({ error: "Onboarding link has expired" }, { status: 410 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    const kind = String(formData.get("kind") ?? "compliance_doc");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: "Only PDF, JPG, PNG, and WebP files are accepted" },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 12 MB limit" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueName = `${crypto.randomUUID().slice(0, 8)}-${safeName}`;
    const subFolder = kind === "logo" ? "logo" : "compliance";
    const storagePath = `${found.orgId}/opcos/${found.opCo.id}/${subFolder}/${uniqueName}`;

    const supabase = createServiceClient();
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadErr) {
      console.error("Onboarding upload error:", uploadErr);
      return NextResponse.json({ error: "Storage upload failed" }, { status: 500 });
    }

    if (kind === "logo") {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json({ error: "Logo must be a PNG, JPG, or WebP image" }, { status: 400 });
      }
      await supabase
        .from("cobid_opcos")
        .update({
          logo_path: storagePath,
          onboarding_status:
            found.opCo.onboardingStatus === "invited" ? "in_progress" : found.opCo.onboardingStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", found.opCo.id)
        .eq("org_id", found.orgId);

      const reloaded = await getOpCoByOnboardingToken(token);
      return NextResponse.json({
        opCo: reloaded?.opCo,
        logoPath: storagePath,
        url: `/api/cobid/files?path=${encodeURIComponent(storagePath)}&onboardingToken=${encodeURIComponent(token)}`,
      });
    }

    const docType = String(formData.get("docType") ?? "other");
    if (!ALLOWED_DOC_TYPES.has(docType)) {
      return NextResponse.json({ error: "Invalid compliance document type" }, { status: 400 });
    }

    const title = String(formData.get("title") ?? "").trim() || file.name;
    const documentNumber = String(formData.get("documentNumber") ?? "").trim();
    const issuerOrInsurer = String(formData.get("issuerOrInsurer") ?? "").trim();
    const coverageAmount = String(formData.get("coverageAmount") ?? "").trim();
    const expiresAtRaw = String(formData.get("expiresAt") ?? "").trim();
    const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(expiresAtRaw) ? expiresAtRaw : null;

    const { error: insertErr } = await supabase.from("cobid_opco_compliance_docs").insert({
      opco_id: found.opCo.id,
      org_id: found.orgId,
      doc_type: docType,
      title,
      document_number: documentNumber,
      issuer_or_insurer: issuerOrInsurer,
      coverage_amount: coverageAmount,
      expires_at: expiresAt,
      file_path: storagePath,
      file_name: file.name,
      status: "pending",
    });

    if (insertErr) {
      throw new Error(insertErr.message);
    }

    if (found.opCo.onboardingStatus === "invited") {
      await supabase
        .from("cobid_opcos")
        .update({ onboarding_status: "in_progress", updated_at: new Date().toISOString() })
        .eq("id", found.opCo.id)
        .eq("org_id", found.orgId);
    }

    const reloaded = await getOpCoByOnboardingToken(token);
    return NextResponse.json({ opCo: reloaded?.opCo }, { status: 201 });
  } catch (err) {
    console.error("POST /api/cobid/onboarding/[token]/upload error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
