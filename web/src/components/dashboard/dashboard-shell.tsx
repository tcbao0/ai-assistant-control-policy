"use client";

import { AgentChat } from "@/components/dashboard/agent-chat";
import { StatusStrip } from "@/components/dashboard/status-strip";

export function DashboardShell() {
  return (
    <div className="space-y-4">
      <StatusStrip />
      <AgentChat />
    </div>
  );
}
