import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export interface StepItem {
  id: string;
  label: string;
}

export function Stepper({
  steps,
  current,
}: {
  steps: StepItem[];
  current: number;
}) {
  return (
    <ol className="grid gap-2 sm:grid-cols-5">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={step.id}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs",
              done && "border-emerald-200 bg-emerald-50 text-emerald-800",
              active && "border-sui bg-sui-soft text-sui-dark",
              !done && !active && "border-slate-200 bg-white text-slate-500",
            )}
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                done && "bg-emerald-500 text-white",
                active && "bg-sui text-white",
                !done && !active && "bg-slate-100 text-slate-500",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className="leading-tight">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
