import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        default: "border-indigo-500/40 bg-indigo-500/15 text-indigo-200",
        success: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
        danger: "border-rose-500/40 bg-rose-500/15 text-rose-200",
        warn: "border-amber-500/40 bg-amber-500/15 text-amber-200",
        muted: "border-slate-600 bg-slate-800 text-slate-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
