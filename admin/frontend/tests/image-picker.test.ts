import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ImagePicker } from "../src/components/ImagePicker";
import { toast } from "sonner";

const mutation = vi.hoisted(() => ({ onError: (_error: Error) => {} }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [] }),
  useQueryClient: () => ({}),
  useMutation: (options: typeof mutation) => { mutation.onError = options.onError; return {}; },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
afterEach(() => { vi.restoreAllMocks(); });

it.each([false, true])("uses the correct upload error scope (post media: %s)", (postMedia) => {
  const error = new Error("Upload refused");
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  renderToStaticMarkup(createElement(ImagePicker, {
    siteKey: "demo", value: "", onChange: () => {},
    ...(postMedia && { mediaUpload: async () => "/media/post/image.png" }),
  }));
  mutation.onError(error);
  expect(logged).toHaveBeenCalledWith(postMedia ? "[blog] upload image failed" : "[image-picker] Failed to upload image", expect.anything());
  expect(toast.error).toHaveBeenCalledWith("Failed to upload image", { description: "Upload refused" });
});
