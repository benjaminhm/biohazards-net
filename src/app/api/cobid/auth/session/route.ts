import { NextResponse } from "next/server";
import { resolveCobidSession } from "@/lib/cobid/session";

export async function GET(req: Request) {
  const session = await resolveCobidSession(req);
  return NextResponse.json({ session });
}
