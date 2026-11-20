"use client";

import { ApprovalDecision } from "@/components/family/approval-decision";
import { useGuardian } from "@/lib/use-guardian";

export default function ApprovalPage({ params }: { params: { id: string } }) {
  const { connection, payments } = useGuardian();
  const payment = payments.find((item) => item.id === params.id);

  if (!payment && connection === "connecting") {
    return <p className="text-sm text-muted-foreground">Loading.</p>;
  }

  if (!payment) {
    return <p className="text-sm text-muted-foreground">That payment could not be found.</p>;
  }

  return <ApprovalDecision key={payment.id} payment={payment} />;
}
