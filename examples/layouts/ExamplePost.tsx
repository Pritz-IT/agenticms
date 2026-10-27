import { RichText, type PostLayoutProps } from "@agenticms/components";

export const layoutKind = "post";
export const keys = {
  "header.title": { type: "text", initial: "AgentiCMS Journal" },
  "header.languages": { type: "text", initial: "Languages" },
  "footer.tagline": { type: "text", initial: "Ideas worth sharing." },
};

export default function ExamplePost({ post, content, locale, locales }: PostLayoutProps) {
  return (
    <main className="example-post">
      <div className="example-post-shell">
        <header className="example-post-header">
          <p>{content["header.title"]}</p>
          <nav aria-label={content["header.languages"]}>
            {post.translations.map((translation) => (
              <a
                key={translation.locale}
                href={translation.url}
                hrefLang={translation.locale}
                lang={translation.locale}
                aria-current={translation.locale === locale ? "page" : undefined}
              >
                {locales.find(({ code }) => code === translation.locale)?.label ?? translation.locale}
              </a>
            ))}
          </nav>
        </header>

        <article>
          <header>
            <p className="example-post-category">{post.category.name}</p>
            <h1>{post.title}</h1>
            {post.publishedAt && <p><time dateTime={post.publishedAt}>{post.publishedAt}</time></p>}
            {post.tags.length > 0 && (
              <ul className="example-post-tags">
                {post.tags.map((tag) => <li key={tag.key}>{tag.name}</li>)}
              </ul>
            )}
          </header>
          {post.coverImage && <img className="example-post-cover" src={post.coverImage} alt={post.title} loading="lazy" />}
          <div className="example-post-body-scroll" role="region" aria-label={post.title} tabIndex={0}>
            <RichText value={post.body} className="example-post-body" />
          </div>
        </article>

        <footer>{content["footer.tagline"]}</footer>
      </div>
      <style>{`
        .example-post {
          min-height: 100vh; background: #f5f4f0; color: #171717;
          font-family: Aptos, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .example-post-shell { max-width: 800px; margin: 0 auto; padding: 32px 24px 72px; }
        .example-post-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 24px; padding-bottom: 64px; }
        .example-post-header p { margin: 0; font-size: 13px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
        .example-post nav { display: flex; flex-wrap: wrap; gap: 18px; font-size: 14px; }
        .example-post a { color: #3f3f46; text-underline-offset: 4px; }
        .example-post a[aria-current="page"] { font-weight: 700; }
        .example-post-category { color: #0e7490; font-size: 12px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; }
        .example-post h1 { margin: 18px 0 28px; font-size: clamp(40px, 7vw, 72px); line-height: 1.05; letter-spacing: -.055em; overflow-wrap: anywhere; }
        .example-post time, .example-post-tags { color: #52525b; font-size: 14px; }
        .example-post-tags { display: flex; flex-wrap: wrap; gap: 18px; padding: 0; list-style: none; }
        .example-post-cover { display: block; width: 100%; height: auto; margin: 32px 0; border-radius: 14px; }
        .example-post-body-scroll { overflow-x: auto; margin-top: 32px; }
        .example-post-body { color: #3f3f46; font-size: 18px; line-height: 1.75; overflow-wrap: anywhere; }
        .example-post-body p { margin: 0 0 1em; }
        .example-post-body figure { margin: 32px 0; }
        .example-post img { max-width: 100%; height: auto; }
        .example-post-body figure img { display: block; }
        .example-post-body figcaption { margin-top: 8px; color: #52525b; font-size: 14px; }
        .example-post-body table { width: 100%; min-width: 32rem; border-collapse: collapse; margin: 24px 0; font-size: 16px; }
        .example-post-body th, .example-post-body td { padding: 12px 16px; border: 1px solid rgba(24, 24, 27, .18); text-align: start; vertical-align: top; }
        .example-post-body th { background: #eae9e5; }
        .example-post footer { margin-top: 64px; padding-top: 24px; border-top: 1px solid rgba(24, 24, 27, .14); color: #52525b; font-size: 14px; }
      `}</style>
    </main>
  );
}
