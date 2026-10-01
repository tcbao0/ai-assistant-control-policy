"use client";

import { AdminActions } from "@/components/dashboard/admin-actions";
import { TransferGrantActions } from "@/components/dashboard/transfer-grant-actions";

export function PoliciesShell() {
  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-white">Policies</h1>
        <p className="text-sm text-slate-400">
          Owner-signed grants. Chat uses the command whitelist. The scheduler uses automatic monthly services.
        </p>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <TransferGrantActions />
        <AdminActions />
      </div>
    </>
  );
}
