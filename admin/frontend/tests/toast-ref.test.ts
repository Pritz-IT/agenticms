import { describe, it, expect, vi } from "vitest";
import { toastError } from "../src/lib/toast-error";
import { ApiError } from "../src/api/client";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("toastError", () => {
  it("includes the request id as a Ref in the toast description", () => {
    toastError("Failed to save", new ApiError(500, "boom", "srv-77"));
    expect((toast.error as any)).toHaveBeenCalledWith(
      "Failed to save",
      expect.objectContaining({ description: expect.stringContaining("srv-77") })
    );
  });

  it("still shows a toast when the error has no request id", () => {
    toastError("Failed", new Error("x"));
    expect((toast.error as any)).toHaveBeenCalled();
  });
});
