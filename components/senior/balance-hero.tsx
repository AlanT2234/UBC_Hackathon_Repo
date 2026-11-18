import { Money } from "@/components/money";
import { greeting } from "@/lib/format";

export function BalanceHero({
  cents,
  name,
}: {
  cents: number;
  name: string;
}) {
  return (
    <section className="space-y-2">
      <p className="text-xl text-ink">{greeting(name)}</p>
      <p className="font-serif text-5xl font-medium leading-none tracking-tight text-ink sm:text-6xl">
        <Money cents={cents} />
      </p>
      <p className="text-xl text-ink">Available to spend</p>
    </section>
  );
}
