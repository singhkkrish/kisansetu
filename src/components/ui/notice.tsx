import { AlertCircle, Info } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

interface NoticeProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: "info" | "warn" | "error";
}

const tones = {
  info: "border-line bg-primary-soft text-ink",
  warn: "border-warn/30 bg-warn-soft text-warn",
  error: "border-danger/30 bg-danger-soft text-danger",
} as const;

/** Inline message for errors and setup problems. Always announces itself to screen readers. */
export function Notice({ tone = "info", className, children, ...props }: NoticeProps) {
  const Icon = tone === "info" ? Info : AlertCircle;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", tones[tone], className)}
      {...props}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
