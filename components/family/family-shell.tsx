"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lockup } from "@/components/brand";
import { ConnectionNotice } from "@/components/connection-notice";
import { ContractNotice } from "@/components/contract-notice";
import { useGuardian } from "@/lib/use-guardian";
import { cn } from "@/lib/utils";

const links = [
  { href: "/family", label: "Overview" },
  { href: "/family/history", label: "Payment history" },
  { href: "/family/rules", label: "Rules" },
];

export function FamilyShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { account } = useGuardian();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="grid min-h-screen md:grid-cols-[240px_1fr]">
        <aside className="surface-dark flex flex-col gap-6 bg-midnight px-4 py-5 text-cream">
          <div>
            <Link href="/family" className="inline-block" aria-label="SafeNSound guardian overview">
              <Lockup className="w-48" />
            </Link>
            <p className="mt-2 text-sm text-cream/75">
              Guardian view
              {account.seniorName ? (
                <>
                  {" "}
                  for <span className="font-bold text-cream">{account.seniorName}</span>
                </>
              ) : null}
            </p>
          </div>
          <nav className="flex flex-wrap gap-1 md:flex-col" aria-label="Family">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-bold",
                    active ? "bg-navy text-cream shadow-[inset_3px_0_0_#5FD3C4]" : "text-cream/75 hover:bg-navy/60 hover:text-cream",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
            <Link
              href="/"
              className="rounded-md px-3 py-2 text-sm font-bold text-cream/75 hover:bg-navy/60 hover:text-cream"
            >
              Senior view
            </Link>
          </nav>
          <ContractNotice tone="dark" className="mt-auto hidden md:flex" />
        </aside>
        <div className="mx-auto flex w-full max-w-5xl flex-col">
          <div className="px-4 pt-6 empty:hidden sm:px-8">
            <ConnectionNotice />
          </div>
          <main className="flex-1 px-4 py-6 sm:px-8">{children}</main>
          <div className="px-4 pb-6 md:hidden">
            <ContractNotice />
          </div>
        </div>
      </div>
    </div>
  );
}
