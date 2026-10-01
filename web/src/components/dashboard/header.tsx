"use client";

import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { LogOut, Shield } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useWalletAuth } from "@/hooks/use-wallet-auth";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Agent" },
  { href: "/assets", label: "Assets" },
  { href: "/policies", label: "Policies" },
] as const;

export function Header() {
  const pathname = usePathname();
  const auth = useWalletAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sui-soft text-sui-dark ring-1 ring-sui/40"
          >
            <Shield className="h-5 w-5" />
          </Link>
          <div className="hidden min-w-0 sm:block">
            <p className="text-sm font-semibold tracking-tight text-black">
              Sui Agent Control Plane
            </p>
            <p className="text-xs text-slate-500">Agent proposes · Owner holds · Chain enforces</p>
          </div>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm whitespace-nowrap",
                  active ? "bg-sui-soft text-sui-dark" : "text-slate-500 hover:bg-sui-soft hover:text-black",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {auth.authorized ? (
            <Button
              variant="outline"
              size="sm"
              disabled={auth.busy}
              onClick={() => void auth.signOut()}
            >
              <LogOut className="h-3.5 w-3.5" />
              Log out
            </Button>
          ) : null}
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
