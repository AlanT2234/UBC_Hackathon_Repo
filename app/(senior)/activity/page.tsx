"use client";

import Link from "next/link";
import { Mic } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PaymentHistory } from "@/components/payment-history";
import { Button } from "@/components/ui/button";
import { useGuardian } from "@/lib/use-guardian";

export default function ActivityPage() {
  const { payments } = useGuardian();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        size="senior"
        title="My payments"
        description="Every payment you asked for, and what happened to it."
      />
      <PaymentHistory payments={payments} size="senior" />
      <Button asChild size="senior" variant="accent" className="mt-2">
        <Link href="/">
          <Mic className="h-7 w-7" aria-hidden="true" />
          Talk to SafeNSound
        </Link>
      </Button>
    </div>
  );
}
