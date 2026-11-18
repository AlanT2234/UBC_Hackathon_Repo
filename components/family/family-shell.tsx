"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ContractNotice } from "@/components/contract-notice";
import { useGuardian } from "@/lib/use-guardian";
import { cn } from "@/lib/utils";

const links = [
  { href: "/family", label: "Overview" },
  { href: "/family/rules", label: "Rules" },
];

export function FamilyShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { account } = useGuardian();

  return (
    <div className="min-h-screen bg-[#f3f0ea] text-ink">
      <div className="mx-auto grid min-h-screen max-w-6xl md:grid-cols-[220px_1fr]">
        <aside className="flex flex-col gap-6 border-b border-border bg-card px-4 py-5 md:border-b-0 md:border-r">
          <div>
            <Link href="/family" className="font-serif text-xl font-medium">
              Guardian
            </Link>
            <p className="mt-1 text-sm text-muted-foreground">{account.seniorName}</p>
          </div>
          <nav className="flex gap-2 md:flex-col" aria-label="Family">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium",
                    active ? "bg-secondary text-ink" : "text-muted-foreground hover:bg-secondary",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
            <Link
              href="/"
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary"
            >
              Senior view
            </Link>
          </nav>
          <ContractNotice className="mt-auto hidden md:flex" />
        </aside>
        <div className="flex flex-col">
          <main className="flex-1 px-4 py-6 sm:px-8">{children}</main>
          <div className="px-4 pb-6 md:hidden">
            <ContractNotice />
          </div>
        </div>
      </div>
    </div>
  );
}
