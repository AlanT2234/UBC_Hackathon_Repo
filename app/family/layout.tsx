import type { ReactNode } from "react";
import { FamilyShell } from "@/components/family/family-shell";

export default function FamilyLayout({ children }: { children: ReactNode }) {
  return <FamilyShell>{children}</FamilyShell>;
}
