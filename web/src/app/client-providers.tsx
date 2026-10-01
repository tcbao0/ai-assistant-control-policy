"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const Providers = dynamic(() => import("@/app/providers").then((mod) => mod.Providers), {
  ssr: false,
});

export function ClientProviders({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
