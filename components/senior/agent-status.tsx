import { Money } from "@/components/money";
import { StatusMark } from "@/components/status-mark";
import type { AgentPhase, Payment } from "@/lib/types";

const titles: Record<AgentPhase, string> = {
  idle: "Ready when you are",
  listening: "Guardian is listening",
  checking: "Checking the rules",
  paid: "Paid",
  held: "Waiting for family",
  blocked: "Blocked",
};

export function AgentStatus({
  phase,
  detail,
}: {
  phase: AgentPhase;
  detail: string;
}) {
  const outcome = phase === "paid" || phase === "held" || phase === "blocked";

  return (
    <section
      className="rounded-lg border border-border bg-card px-5 py-5"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-serif text-3xl font-medium text-ink">{titles[phase]}</h2>
        {outcome ? <StatusMark status={phase} size="senior" /> : null}
      </div>
      <p className="mt-3 text-xl leading-relaxed text-ink">{detail}</p>
    </section>
  );
}

export function LastRequest({ payment }: { payment: Payment | null }) {
  if (!payment) return null;

  return (
    <section className="rounded-lg border border-border bg-card px-5 py-5">
      <h2 className="text-xl font-bold text-ink">Last request</h2>
      <p className="mt-2 font-serif text-4xl font-medium text-ink">
        <Money cents={payment.amountCents} />
        <span className="mt-1 block text-3xl">{payment.recipientName}</span>
      </p>
      <p className="mt-2 text-xl leading-relaxed text-ink">{payment.reason}</p>
    </section>
  );
}
