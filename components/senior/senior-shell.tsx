"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lockup } from "@/components/brand";
import { ConnectionNotice } from "@/components/connection-notice";
import { ContractNotice } from "@/components/contract-notice";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Home" },
  { href: "/activity", label: "My payments" },
  { href: "/family", label: "Guardian view" },
];

export function SeniorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="surface-dark bg-midnight">
        <div className="mx-auto w-full max-w-3xl px-5 py-4 sm:px-8">
          <Link href="/" className="inline-block" aria-label="SafeNSound home">
            <Lockup className="w-56 sm:w-64" />
          </Link>
        </div>
      </header>
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-3xl flex-col px-5 py-6 sm:px-8">
        <nav className="grid grid-cols-3 gap-3" aria-label="Senior">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-14 items-center justify-center rounded-lg border-2 px-3 py-3 text-center text-xl font-bold leading-tight",
                  active ? "border-navy bg-navy text-cream" : "border-border bg-card text-ink hover:border-navy",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="pt-6 empty:hidden">
          <ConnectionNotice size="senior" />
        </div>
        <main className="flex flex-1 flex-col py-8">{children}</main>
        <ContractNotice size="senior" />
      </div>
    </div>
  );
}
