import { toast } from "sonner";
import { ApiError } from "../api/client";
import { logError } from "./log";

// Single entry point for error toasts: guarantees a durable console.error
// and surfaces the correlation id so the user can read it back to support.
export function toastError(title: string, err: unknown, scope = "ui"): void {
  const requestId = err instanceof ApiError ? err.requestId : "";
  logError(scope, title, { err: String(err), requestId });
  toast.error(title, {
    description: requestId
      ? `Ref: ${requestId}`
      : err instanceof Error
        ? err.message
        : undefined,
  });
}
