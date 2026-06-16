# AgentiCMS Layout Authoring

Layouts are React `.tsx` files placed in the configured layouts directory.
In local development that directory is:

```text
.agenticms/layouts
```

For multisite work, select the site and optional local roots in:

```json
{
  "site": "demo",
  "sites": {
    "demo": { "layouts": "layouts/demo", "assets": "assets/demo" },
    "agenticms": { "layouts": "layouts/agenticms", "assets": "assets/agenticms" }
  }
}
```

Then sync a single site with:

```bash
cd cli && node dist/main.js sync layouts --site demo --url <admin-url>
```

The admin backend watches this directory, parses each layout's static `keys`
export, and registers the layout in the admin UI.

A tracked starter example lives at:

```text
examples/layouts/Home.tsx
```

Copy it into the selected site's layout root, for example
`.agenticms/layouts/demo/Home.tsx`, when you want the local watcher or CLI sync
to register it for that site.

## Minimal Layout

```tsx
import { RichText, type LayoutProps } from "@agenticms/components";

export const keys = {
  "_meta.title": { type: "text", initial: "Home" },
  "_meta.description": { type: "text", initial: "Welcome to the website." },
  "hero.title": { type: "text", initial: "Welcome" },
  "hero.body": { type: "richtext", initial: "<p>Edit this copy in AgentiCMS.</p>" },
};

export default function HomeLayout({ content }: LayoutProps) {
  return (
    <main>
      <h1>{content["hero.title"]}</h1>
      <RichText value={content["hero.body"]} />
    </main>
  );
}
```

## Layout Props

Every layout receives:

```ts
interface LayoutProps {
  content: Record<string, string>;
  navigation: NavigationItem[];
  locale: string;
  locales: LocaleOption[];
  settings: SiteSettings | null;
}
```

Import the public type from:

```tsx
import type { LayoutProps } from "@agenticms/components";
```

## Field Types

Supported key types:

- `text`: render with normal React text interpolation.
- `richtext`: render with `<RichText value={...} />`.
- `image`: render with `<ImageField src={...} alt="..." />`.
- `link`: render with `<LinkField href={...}>Label</LinkField>`.

## Rich Text Rule

Do not use `dangerouslySetInnerHTML` in customer layouts.

Use:

```tsx
<RichText value={content["body.text"]} />
```

`RichText` centralizes HTML rendering and sanitization.

## Parser Constraints

The `keys` object must be static and simple:

- Use `export const keys = { ... };`.
- Use string literal keys.
- Use string literal `type` and `initial` values.
- Keep each entry in this shape:

```tsx
"section.title": { type: "text", initial: "Initial value" },
```

The parser does not execute TypeScript or evaluate variables. It only extracts
static key definitions from source text.

## Build Flow

1. Add or edit a `.tsx` file in the selected site's layout root.
2. The admin watcher or CLI sync registers the layout and detected keys for that site.
3. Assign the layout to a page in the admin UI.
4. Edit content and publish the page.
5. Trigger a staging or production build.
6. The website builder copies layouts into `website/src/layouts` and Astro
   compiles them there, where `@agenticms/components` resolves.
