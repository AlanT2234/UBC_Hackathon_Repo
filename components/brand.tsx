import { cn } from "@/lib/utils";

/**
 * The SafeNSound lockup. Its wordmark is cream, so it only goes on midnight surfaces; the asset
 * carries its own midnight background (SafeNSound-logos/final).
 */
export function Lockup({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG, nothing for next/image to optimize
    <img
      src="/brand/safensound-lockup-on-midnight.svg"
      alt="SafeNSound"
      width={1195}
      height={360}
      className={cn("h-auto", className)}
    />
  );
}

export function Shield({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG, nothing for next/image to optimize
    <img src="/brand/safensound-icon.svg" alt="" width={512} height={512} className={className} aria-hidden="true" />
  );
}

/** The heartbeat line from the shield. `live` draws it in a loop (paused for reduced motion). */
export function Pulse({ live = false, className }: { live?: boolean; className?: string }) {
  return (
    <svg
      viewBox="112 318 288 68"
      className={cn("text-teal", live && "pulse-live", className)}
      fill="none"
      preserveAspectRatio="xMinYMid meet"
      aria-hidden="true"
    >
      <path
        d="M120 352 H178 L190 334 L202 370 L214 326 L226 378 L238 340 L250 362 L262 346 L274 358 H392"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
    </svg>
  );
}
