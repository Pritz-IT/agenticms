import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { postDraft, updateTranslationTitle, emptyTranslation, stagingPostUrl } from "../src/lib/blog-editor";
import { replaceSiteKeyInPath } from "../src/site-routing";
import { blogErrorMessage } from "../src/lib/blog-error";
import { ApiError } from "../src/api/client";
import type { BlogPost } from "../src/api/types";

describe("blog editor helpers", () => {
  it("sends only writable fields, preserving every translation and its status", () => {
    const translation = {
      ...emptyTranslation(),
      title: "Bus",
      slug: "bus",
      status: "published" as const,
      updatedAt: "2026-10-27",
    };
    const post: BlogPost = {
      key: "bus",
      category: "news",
      tags: ["transport"],
      layout: null,
      publishedAt: "2026-10-27",
      updatedAt: "2026-10-27",
      translations: { de: translation, en: { ...translation, status: "draft" } },
    };
    const draft = postDraft(post);
    assert.equal("updatedAt" in draft, false);
    assert.equal("updatedAt" in draft.translations.de, false);
    assert.equal(draft.translations.de.status, "published");
    assert.equal(draft.translations.en.status, "draft");
    assert.deepEqual(draft.tags, ["transport"]);
  });
  it("prefills the slug until a manual edit, independently per translation", () => {
    const initial = emptyTranslation();
    assert.equal(updateTranslationTitle(initial, "Über uns", false).slug, "ueber-uns");
    assert.equal(updateTranslationTitle({ ...initial, slug: "custom" }, "Changed", true).slug, "custom");
  });
  it("matches locale-aware public routes on the staging host", () => {
    assert.equal(
      stagingPostUrl("stage.example.com", "/news", "de", "de", "bus"),
      "https://stage.example.com/news/bus/"
    );
    assert.equal(
      stagingPostUrl("stage.example.com", "/company/news", "en", "de", "bus"),
      "https://stage.example.com/en/company/news/bus/"
    );
  });
  it("returns to the blogs list when switching sites from an editor", () => {
    assert.equal(replaceSiteKeyInPath("/sites/demo/blogs/bus", "demo", "other"), "/sites/other/blogs");
  });
});

describe("blog API error messages", () => {
  it("shows validation and conflict names without JSON wrapping", () => {
    assert.equal(
      blogErrorMessage(new ApiError(400, '{"error":"Invalid slug for de"}')),
      "Invalid slug for de"
    );
    assert.equal(
      blogErrorMessage(new ApiError(409, '{"error":"Blog category is used by post bus, page /news"}')),
      "Blog category is used by post bus, page /news"
    );
    assert.equal(blogErrorMessage(new Error("Network unavailable")), "Network unavailable");
  });
});
