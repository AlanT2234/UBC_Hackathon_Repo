import { Pulse } from "@/components/brand";
import { Money } from "@/components/money";
import { greeting } from "@/lib/format";

export function BalanceHero({
  cents,
  name,
  frozen = false,
}: {
  cents: number;
  name: string;
  frozen?: boolean;
}) {
  return (
    <section className="surface-dark overflow-hidden rounded-2xl bg-navy px-6 py-6 text-cream shadow-[0_10px_30px_-12px_rgba(20,38,63,0.55)]">
      <p className="text-xl">{greeting(name)}</p>
      <p className="mt-3 font-display text-5xl font-extrabold leading-none tracking-tight sm:text-6xl">
        <Money cents={cents} />
      </p>
      <p className="mt-2 text-xl text-cream/85">
        {frozen ? "Payments are paused while your family checks on something." : "Available to spend"}
      </p>
      <Pulse className="mt-4 h-8 w-full max-w-xs" />
    </section>
  );
}
