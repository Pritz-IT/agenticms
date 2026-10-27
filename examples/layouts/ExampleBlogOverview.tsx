import { formatPostDate } from "./lib/format-post-date";
import type { LayoutProps } from "@agenticms/components";

export const keys = {
  "_meta.title": { type: "text", initial: "Journal" },
  "blog.title": { type: "text", initial: "Stories and ideas" },
  "blog.description": { type: "text", initial: "Updates, practical guides, and things we have learned along the way." },
  "blog.empty": { type: "text", initial: "No posts yet. Check back soon." },
  "blog.pagination": { type: "text", initial: "Blog pages" },
  "blog.previous": { type: "text", initial: "Previous" },
  "blog.next": { type: "text", initial: "Next" },
  "blog.list": { type: "bloglist", initial: "" },
};

export default function ExampleBlogOverview({ content, blogLists, locale }: LayoutProps) {
  const { posts, pagination } = blogLists["blog.list"] ?? { posts: [], pagination: null };

  return (
    <main className="example-blog">
      <div className="example-blog-shell">
        <header>
          <h1>{content["blog.title"]}</h1>
          <p className="example-blog-lead">{content["blog.description"]}</p>
        </header>

        {posts.length === 0 ? <p className="example-blog-empty">{content["blog.empty"]}</p> : (
          <div className="example-blog-posts">
            {posts.map((post) => (
              <article key={post.key}>
                <p className="example-blog-category">{post.category.name}</p>
                <h2><a href={post.url}>{post.title}</a></h2>
                <p>{post.excerpt}</p>
                {post.publishedAt && <time dateTime={post.publishedAt}>{formatPostDate(post.publishedAt, locale)}</time>}
              </article>
            ))}
          </div>
        )}

        {pagination && (
          <nav className="example-blog-pagination" aria-label={content["blog.pagination"]}>
            {pagination.prevUrl && <a href={pagination.prevUrl} rel="prev">{content["blog.previous"]}</a>}
            {pagination.pages.map((page) => (
              <a key={page.number} href={page.url} aria-current={page.number === pagination.current ? "page" : undefined}>
                {page.number}
              </a>
            ))}
            {pagination.nextUrl && <a href={pagination.nextUrl} rel="next">{content["blog.next"]}</a>}
          </nav>
        )}
      </div>
      <style>{`
        .example-blog {
          min-height: 100vh; background: #f5f4f0; color: #171717;
          font-family: Aptos, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .example-blog-shell { max-width: 1180px; margin: 0 auto; padding: 64px 24px 72px; }
        .example-blog h1 { max-width: 760px; margin: 0; font-size: clamp(44px, 7vw, 86px); line-height: 1; letter-spacing: -.055em; overflow-wrap: anywhere; }
        .example-blog-lead { max-width: 620px; margin: 28px 0 44px; color: #52525b; font-size: 19px; line-height: 1.7; }
        .example-blog-posts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 24px; }
        .example-blog article { min-width: 0; padding: 28px; border: 1px solid rgba(24, 24, 27, .14); overflow-wrap: anywhere; }
        .example-blog-category { margin: 0 0 18px; color: #0e7490; font-size: 12px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; }
        .example-blog h2 { margin: 0 0 18px; font-size: 28px; line-height: 1.15; letter-spacing: -.035em; }
        .example-blog a { color: inherit; text-underline-offset: 4px; }
        .example-blog article > p:not(.example-blog-category) { color: #52525b; line-height: 1.7; }
        .example-blog time { color: #52525b; font-size: 14px; }
        .example-blog-empty { padding: 32px 0; border-top: 1px solid rgba(24, 24, 27, .14); color: #52525b; }
        .example-blog-pagination { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 44px; }
        .example-blog-pagination a { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; padding: 0 10px; box-sizing: border-box; border: 1px solid rgba(24, 24, 27, .14); }
        .example-blog-pagination a[aria-current="page"] { background: #171717; color: #fff; font-weight: 700; }
      `}</style>
    </main>
  );
}
