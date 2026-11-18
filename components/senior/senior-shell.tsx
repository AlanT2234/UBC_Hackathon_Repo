import type { ReactNode } from "react";
import Link from "next/link";
import { ContractNotice } from "@/components/contract-notice";

export function SeniorShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-6 sm:px-8">
        <header className="flex flex-col gap-4">
          <Link href="/" className="font-serif text-3xl font-medium text-ink">
            Guardian
          </Link>
          <nav className="grid grid-cols-2 gap-3" aria-label="Senior">
            <Link
              href="/activity"
              className="inline-flex min-h-14 items-center justify-center rounded-lg border border-border bg-card px-3 py-3 text-center text-xl font-semibold leading-tight text-ink"
            >
              Recent payments
            </Link>
            <Link
              href="/family"
              className="inline-flex min-h-14 items-center justify-center rounded-lg border border-border bg-card px-3 py-3 text-center text-xl font-semibold leading-tight text-ink"
            >
              Family view
            </Link>
          </nav>
        </header>
        <main className="flex flex-1 flex-col py-8">{children}</main>
        <ContractNotice size="senior" />
      </div>
    </div>
  );
}
