import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageField, LinkField } from "@agenticms/components";
import type { LayoutProps } from "@agenticms/components";

const props: LayoutProps = {
  content: {
    "hero.title": "AgentiCMS",
  },
  navigation: [],
  locale: "en",
  locales: [{ id: "loc-en", code: "en", label: "English", isDefault: true, sortOrder: 0 }],
  settings: {
    id: "settings",
    name: "AgentiCMS",
    domain: "localhost",
    stagingDomain: "staging.localhost",
    defaultLocale: "en",
  },
};

assert.equal(props.content["hero.title"], "AgentiCMS");

assert.equal(
  renderToStaticMarkup(<ImageField src="/assets/hero.jpg" alt="Hero" className="media" />),
  '<img src="/assets/hero.jpg" alt="Hero" class="media"/>'
);

assert.equal(
  renderToStaticMarkup(<ImageField src="" alt="Hero" fallback="/assets/fallback.jpg" />),
  '<img src="/assets/fallback.jpg" alt="Hero"/>'
);

assert.equal(
  renderToStaticMarkup(<LinkField href="/contact" className="link">Contact</LinkField>),
  '<a href="/contact" class="link">Contact</a>'
);

assert.equal(
  renderToStaticMarkup(<LinkField href="">Missing</LinkField>),
  '<span>Missing</span>'
);
