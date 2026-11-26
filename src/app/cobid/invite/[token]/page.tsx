"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Lock,
  MapPin,
  ShieldCheck,
} from "lucide-react";

interface InviteDetails {
  id: string;
  email: string;
  recipientName: string;
  roleType: "coordinator" | "contractor" | "client";
  opCoId: string | null;
  status: string;
  expiresAt: string;
  job: {
    id: string;
    reference: string;
    title: string;
    propertyAddress: string;
    suburbState: string;
    leadSource: string;
  };
  opCo: {
    companyName: string;
    abn: string;
    tradeCategory: string;
    sequenceOrder: number;
  } | null;
}

export default function CobidMagicLinkInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params?.token;

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/cobid/invites/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Invalid invite link");
        setInvite(data.invite);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch(`/api/cobid/invites/${encodeURIComponent(token)}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not sign in");
      // If accessed via /invite/<token> on app.hazmatmanagement.com.au, land on /;
      // if accessed via /cobid/invite/<token> on localhost or biohazards.net, land on /cobid.
      const onCobidPath =
        typeof window !== "undefined" && window.location.pathname.startsWith("/cobid/");
      router.push(onCobidPath ? "/cobid" : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invite");
      setAccepting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 bg-slate-950 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-xs font-bold text-slate-950">
              HM
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Hazmat Management · Co-Bid Workspace
              </div>
              <h1 className="text-base font-semibold">Secure Magic-Link Workspace Invite</h1>
            </div>
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="py-10 text-center text-xs text-slate-500">
              Verifying cryptographic invite token…
            </div>
          ) : error || !invite ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-rose-600" />
              <h2 className="mt-2 text-sm font-semibold text-rose-900">Invite Unavailable</h2>
              <p className="mt-1 text-xs text-rose-700">
                {error || "This invite link could not be found."}
              </p>
            </div>
          ) : invite.status === "revoked" || invite.status === "expired" ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
              <h2 className="mt-2 text-sm font-semibold text-amber-900">
                Invite {invite.status === "revoked" ? "Revoked" : "Expired"}
              </h2>
              <p className="mt-1 text-xs text-amber-800">
                Please request a fresh magic-link invite from the Hazmat Management Scoping Desk.
              </p>
            </div>
          ) : (
            <div className="space-y-5 text-xs">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Invited Participant
                </div>
                <div className="mt-1 text-base font-bold text-slate-900">
                  {invite.recipientName}
                </div>
                <div className="text-slate-600">{invite.email}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-semibold text-slate-500">
                    {invite.job.reference}
                  </span>
                  <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                    {invite.roleType === "contractor"
                      ? `Stage ${invite.opCo?.sequenceOrder ?? ""} OpCo`
                      : invite.roleType}
                  </span>
                </div>
                <div className="mt-2 flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {invite.job.propertyAddress}, {invite.job.suburbState}
                    </div>
                    <div className="text-slate-600">{invite.job.title}</div>
                  </div>
                </div>

                {invite.opCo && (
                  <div className="mt-3 flex items-start gap-2 border-t border-slate-200 pt-3">
                    <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div>
                      <div className="font-semibold text-slate-900">
                        {invite.opCo.companyName}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        ABN {invite.opCo.abn} · {invite.opCo.tradeCategory}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-[11px] text-emerald-900">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <div>
                  <strong>Ring-Fenced Session:</strong> Signing in via this magic link locks your
                  session to your role on <strong>{invite.job.reference}</strong>.{" "}
                  {invite.roleType === "contractor"
                    ? "Your commercial scope, pricing, agreement, and direct deposit details are strictly isolated from other OpCos."
                    : "All agreements and deposits remain legally separate per Operating Company."}
                </div>
              </div>

              <button
                onClick={handleAccept}
                disabled={accepting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xs transition hover:bg-slate-800 disabled:opacity-50"
              >
                {accepting ? (
                  "Establishing Secure Session…"
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    Authenticate & Enter Workspace
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>

              {invite.status === "accepted" && (
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Previously accepted — clicking above will refresh your secure session.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
