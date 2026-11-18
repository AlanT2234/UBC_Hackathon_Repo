import type { ReactNode } from "react";
import { SeniorShell } from "@/components/senior/senior-shell";

export default function SeniorLayout({ children }: { children: ReactNode }) {
  return <SeniorShell>{children}</SeniorShell>;
}
