"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu, X } from "lucide-react";
import {
  HAZMAT_NAV_ITEMS,
  hazmatHref,
  isActiveHazmatRoute,
} from "./paths";

function HazmatMonogram({ inverted = false }: { inverted?: boolean }) {
  return (
    <span
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border ${
        inverted
          ? "border-slate-700 bg-slate-800 text-slate-100"
          : "border-slate-900 bg-[#0F172A] text-white"
      }`}
      aria-hidden="true"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M2.5 3.5V14.5M8.5 3.5V14.5M2.5 9H8.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="square"
        />
        <path
          d="M11.25 14.5V3.5L13.5 8.5L15.75 3.5V14.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      </svg>
    </span>
  );
}

export default function SiteShell({
  basePath,
  children,
}: {
  basePath: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-[#F8FAFC] text-[#0F172A]">
      {/* Top Institutional Navigation */}
      <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-[#F8FAFC]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <Link
            href={hazmatHref(basePath, "")}
            className="flex items-center gap-3 text-[#0F172A] hover:opacity-90"
            onClick={() => setMobileOpen(false)}
          >
            <HazmatMonogram />
            <div className="flex flex-col leading-tight">
              <span className="text-[14px] font-semibold tracking-tight text-[#0F172A]">
                HAZMAT Management{" "}
                <span className="font-normal text-slate-500">Pty Ltd</span>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                Independent Coordination Platform
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-1 lg:flex"
          >
            {HAZMAT_NAV_ITEMS.map((item) => {
              const active = isActiveHazmatRoute(pathname, basePath, item.route);
              return (
                <Link
                  key={item.route || "home"}
                  href={hazmatHref(basePath, item.route)}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 text-[13.5px] transition-colors ${
                    active
                      ? "bg-slate-900/[0.06] font-semibold text-[#0F172A]"
                      : "font-medium text-slate-600 hover:bg-slate-200/50 hover:text-[#0F172A]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Quiet Secondary Utility Link + Mobile Toggle */}
          <div className="flex items-center gap-2.5">
            <a
              href="https://app.hazmatmanagement.com.au"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-[#0F172A] sm:inline-flex"
            >
              <span>Operator Portal</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
            </a>

            <button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-expanded={mobileOpen}
              aria-label="Toggle navigation menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 lg:hidden"
            >
              {mobileOpen ? (
                <X className="h-4 w-4" />
              ) : (
                <Menu className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileOpen && (
          <div className="border-t border-slate-200 bg-white px-5 py-4 lg:hidden">
            <nav
              aria-label="Mobile navigation"
              className="flex flex-col gap-1"
            >
              {HAZMAT_NAV_ITEMS.map((item) => {
                const active = isActiveHazmatRoute(pathname, basePath, item.route);
                return (
                  <Link
                    key={item.route || "home"}
                    href={hazmatHref(basePath, item.route)}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={`rounded-md px-3 py-2 text-[14px] ${
                      active
                        ? "bg-slate-100 font-semibold text-[#0F172A]"
                        : "font-medium text-slate-600 hover:bg-slate-50 hover:text-[#0F172A]"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <div className="mt-2 border-t border-slate-200 pt-3">
                <a
                  href="https://app.hazmatmanagement.com.au"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-between rounded-md border border-slate-300 bg-[#F8FAFC] px-3 py-2 text-[13.5px] font-medium text-slate-700"
                >
                  <span>Operator Portal (app.hazmatmanagement.com.au)</span>
                  <ArrowUpRight className="h-4 w-4 text-slate-400" />
                </a>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Institutional Footer */}
      <footer className="border-t border-slate-800 bg-[#0F172A] text-slate-300">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
          <div className="grid gap-10 md:grid-cols-12">
            {/* Entity Notice */}
            <div className="space-y-4 md:col-span-6">
              <div className="flex items-center gap-3">
                <HazmatMonogram inverted />
                <div>
                  <p className="text-[14px] font-semibold tracking-tight text-white">
                    HAZMAT Management Pty Ltd
                  </p>
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-slate-400">
                    Queensland &amp; Australia
                  </p>
                </div>
              </div>

              <p className="max-w-lg text-[13.5px] leading-relaxed text-slate-200">
                HAZMAT Management Pty Ltd &middot; Independent Coordination
                Platform &mdash; Not a Partnership or Subcontracting Arrangement.
              </p>

              <p className="max-w-lg text-[12.5px] leading-relaxed text-slate-400">
                Every operating company participating on the platform is an
                independent legal entity responsible for its own scope,
                quotation, client agreement, statutory licences, insurances,
                workmanship, and direct invoicing.
              </p>

              <div className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-slate-700/80 bg-slate-900/70 px-3 py-2 font-mono text-[11px] text-slate-300">
                <span>
                  ABN:{" "}
                  <span className="text-amber-300">
                    [XX XXX XXX XXX &mdash; PLACEHOLDER]
                  </span>
                </span>
                <span className="text-slate-600">|</span>
                <span>
                  ACN:{" "}
                  <span className="text-amber-300">
                    [XXX XXX XXX &mdash; PLACEHOLDER]
                  </span>
                </span>
              </div>
            </div>

            {/* Reference Pages */}
            <div className="space-y-3 md:col-span-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400">
                Reference Index
              </p>
              <ul className="space-y-2 text-[13.5px]">
                {HAZMAT_NAV_ITEMS.map((item) => (
                  <li key={item.route || "home"}>
                    <Link
                      href={hazmatHref(basePath, item.route)}
                      className="text-slate-300 transition-colors hover:text-white"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Platform Infrastructure & Admin */}
            <div className="space-y-3 md:col-span-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400">
                Platform &amp; Administration
              </p>
              <ul className="space-y-2.5 text-[13.5px]">
                <li>
                  <a
                    href="https://app.hazmatmanagement.com.au"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-slate-300 transition-colors hover:text-white"
                  >
                    <span>app.hazmatmanagement.com.au</span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-slate-500" />
                  </a>
                  <p className="text-[11.5px] text-slate-500">
                    Approved operator &amp; coordinator workspace
                  </p>
                </li>
                <li>
                  <a
                    href="https://docs.hazmatmanagement.com.au"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-slate-300 transition-colors hover:text-white"
                  >
                    <span>docs.hazmatmanagement.com.au</span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-slate-500" />
                  </a>
                  <p className="text-[11.5px] text-slate-500">
                    Token-scoped client quote &amp; signing links
                  </p>
                </li>
                <li className="pt-1">
                  <a
                    href="mailto:admin@hazmatmanagement.com.au"
                    className="font-mono text-[12.5px] text-teal-300 transition-colors hover:text-teal-200"
                  >
                    admin@hazmatmanagement.com.au
                  </a>
                  <p className="text-[11.5px] text-slate-500">
                    Governance, due diligence &amp; onboarding enquiries
                  </p>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-2 border-t border-slate-800 pt-6 text-[12px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>&copy; 2026 HAZMAT Management Pty Ltd. All rights reserved.</p>
            <p className="font-mono text-[11px] text-slate-500">
              INDEPENDENT ENTITIES ONLY &middot; DIRECT-TO-OPERATOR SETTLEMENT
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
