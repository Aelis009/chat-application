import type { ReactNode } from "react";
import AuthenticatedLayoutClient from "@/components/chat/AuthenticatedLayout";

export const instant = false;

export default function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AuthenticatedLayoutClient>{children}</AuthenticatedLayoutClient>;
}
