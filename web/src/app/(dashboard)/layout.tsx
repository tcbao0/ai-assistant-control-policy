"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const DashboardFrame = dynamic(
  () => import("@/components/dashboard/dashboard-frame").then((mod) => mod.DashboardFrame),
  { ssr: false, loading: () => <div className="min-h-screen bg-white" /> },
);

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardFrame>{children}</DashboardFrame>;
}
