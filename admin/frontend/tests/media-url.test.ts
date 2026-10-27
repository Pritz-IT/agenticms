import { afterEach, expect, it, vi } from "vitest";
import { fetchMediaObjectUrl } from "../src/lib/media-url";
import { uploadBlogPostMedia } from "../src/api/blog";
import { setAccessToken } from "../src/api/client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAccessToken("");
});

it("fetches private media with Bearer auth and leaves public sources unchanged", async () => {
  setAccessToken("media-test-token");
  const fetch = vi.fn().mockResolvedValue(new Response(new Blob(["image"], { type: "image/png" })));
  vi.stubGlobal("fetch", fetch);
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  expect(await fetchMediaObjectUrl("site name", "/assets/site/public.png")).toBe("/assets/site/public.png");
  expect(fetch).not.toHaveBeenCalled();
  expect(await fetchMediaObjectUrl("site name", "/media/post/photo.png")).toBe("blob:preview");
  expect(fetch.mock.calls[0][0]).toBe("/api/sites/site%20name/blog/media/post/photo.png");
  expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer media-test-token");
  expect(create).toHaveBeenCalledWith(expect.any(Blob));
});

it("rejects failed media responses without creating object URLs", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Missing", { status: 404 })));
  const create = vi.spyOn(URL, "createObjectURL");
  await expect(fetchMediaObjectUrl("demo", "/media/post/missing.png")).rejects.toThrow("Missing");
  expect(create).not.toHaveBeenCalled();
});

it("uploads to the post's private media endpoint using multipart file and returns the canonical URL", async () => {
  const file = new File(["image"], "photo.png", { type: "image/png" });
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: "/media/post/photo.png" })));
  vi.stubGlobal("fetch", fetch);
  setAccessToken("upload-test-token");
  expect(await uploadBlogPostMedia("site name", "post key", file)).toBe("/media/post/photo.png");
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("/api/sites/site%20name/blog/posts/post%20key/media");
  expect(options.method).toBe("POST");
  expect(options.body.get("file")).toBe(file);
  expect(options.headers.get("Authorization")).toBe("Bearer upload-test-token");
  expect(options.headers.has("Content-Type")).toBe(false);
});
