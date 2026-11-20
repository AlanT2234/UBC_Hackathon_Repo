import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  size = "family",
}: {
  title: string;
  description?: string;
  size?: "senior" | "family";
}) {
  const senior = size === "senior";
  return (
    <header className={cn(senior ? "space-y-3" : "space-y-1")}>
      <h1
        className={cn(
          "font-display font-extrabold text-ink",
          senior ? "text-4xl leading-tight sm:text-5xl" : "text-2xl",
        )}
      >
        {title}
      </h1>
      {description ? (
        <p className={cn(senior ? "text-xl leading-relaxed text-ink" : "text-sm text-muted-foreground")}>
          {description}
        </p>
      ) : null}
    </header>
  );
}
