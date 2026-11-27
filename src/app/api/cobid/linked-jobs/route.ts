import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { resolveCobidSession } from "@/lib/cobid/session";

export async function GET(req: NextRequest) {
  try {
    const session = await resolveCobidSession(req);
    if (!session || session.roleType !== "coordinator") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServiceClient();
    const jobId = req.nextUrl.searchParams.get("jobId");

    if (jobId) {
      const [jobRes, photosRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, job_code, site_address, suburb, state, postcode, client_name, client_email, client_phone, job_type, notes")
          .eq("id", jobId)
          .eq("org_id", session.orgId)
          .maybeSingle(),
        supabase
          .from("photos")
          .select("id, url, caption, category, uploaded_at")
          .eq("job_id", jobId)
          .order("uploaded_at", { ascending: false })
          .limit(60),
      ]);

      return NextResponse.json({
        job: jobRes.data ?? null,
        photos: photosRes.data ?? [],
      });
    }

    const { data, error } = await supabase
      .from("jobs")
      .select("id, job_code, site_address, suburb, state, postcode, client_name, client_email, client_phone, job_type, created_at")
      .eq("org_id", session.orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throw new Error(error.message);
    return NextResponse.json({ jobs: data ?? [] });
  } catch (err) {
    console.error("GET /api/cobid/linked-jobs error:", err);
    return NextResponse.json({ error: "Failed to load jobs" }, { status: 500 });
  }
}
