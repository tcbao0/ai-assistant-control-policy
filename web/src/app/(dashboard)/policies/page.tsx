"use client";

import dynamic from "next/dynamic";

const PoliciesShell = dynamic(
  () => import("@/components/dashboard/policies-shell").then((mod) => mod.PoliciesShell),
  { ssr: false },
);

export default function PoliciesPage() {
  return <PoliciesShell />;
}
