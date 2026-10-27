import { toast } from "sonner";
import { ApiError } from "../api/client";

export function blogErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "An unexpected error occurred.";
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.message);
      if (typeof body.message === "string") return body.message;
      if (typeof body.error === "string") return body.error;
    } catch (parseError) {
      console.warn("[blog] API error response is not JSON", parseError);
    }
  }
  return error.message;
}

export function showBlogError(action: string, error: unknown): void {
  console.error(`[blog] ${action} failed`, error);
  toast.error(`Failed to ${action}`, { description: blogErrorMessage(error) });
}
