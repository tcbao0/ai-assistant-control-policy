"use client";

import dynamic from "next/dynamic";

const AssetsShell = dynamic(
  () => import("@/components/dashboard/assets-shell").then((mod) => mod.AssetsShell),
  { ssr: false },
);

export default function AssetsPage() {
  return <AssetsShell />;
}
