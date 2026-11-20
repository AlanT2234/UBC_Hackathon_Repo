import { Pulse } from "@/components/brand";
import { Money } from "@/components/money";
import { StatusMark } from "@/components/status-mark";
import { OUTCOME_LABEL } from "@/lib/history";
import type { AgentPhase, Payment } from "@/lib/types";
import { cn } from "@/lib/utils";

const titles: Record<AgentPhase, string> = {
  idle: "Ready when you are",
  listening: "SafeNSound is listening",
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
  const live = phase === "listening" || phase === "checking";

  return (
    <section
      className={cn(
        "rounded-2xl border-2 bg-card px-5 py-5",
        live ? "border-teal" : outcome ? "border-border" : "border-border",
      )}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-3xl font-extrabold tracking-tight text-ink">{titles[phase]}</h2>
        {outcome ? <StatusMark status={phase} size="senior" /> : null}
      </div>
      {live ? <Pulse live className="mt-3 h-8 w-48 text-teal-deep" /> : null}
      <p className="mt-3 text-xl leading-relaxed text-ink">{detail}</p>
    </section>
  );
}

export function LastRequest({ payment }: { payment: Payment | null }) {
  if (!payment) return null;

  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-ink">Last request</h2>
        <StatusMark status={payment.status} label={OUTCOME_LABEL[payment.outcome]} size="senior" />
      </div>
      <p className="mt-2 font-display text-4xl font-extrabold tracking-tight text-ink">
        <Money cents={payment.amountCents} />
        <span className="mt-1 block text-3xl">{payment.recipientName}</span>
      </p>
      <p className="mt-2 text-xl leading-relaxed text-ink">{payment.reason}</p>
    </section>
  );
}
