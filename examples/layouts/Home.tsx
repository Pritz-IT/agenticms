import type { CSSProperties } from "react";
import { ImageField, LinkField, RichText, type LayoutProps } from "@agenticms/components";

export const keys = {
  "_meta.title": { type: "text", initial: "AgentiCMS" },
  "_meta.description": { type: "text", initial: "A fast CMS for static customer websites." },
  "hero.kicker": { type: "text", initial: "Static CMS" },
  "hero.title": { type: "text", initial: "Launch polished websites without touching Git" },
  "hero.body": { type: "richtext", initial: "<p>AgentiCMS gives editors a clean admin UI while the public website stays static, fast, and simple to host.</p>" },
  "hero.image": { type: "image", initial: "/assets/agenticms-hero.jpg" },
  "hero.cta.label": { type: "text", initial: "Start editing" },
  "hero.cta.link": { type: "link", initial: "/contact" },
  "section.kicker": { type: "text", initial: "What changes" },
  "section.title": { type: "text", initial: "Content work becomes a focused workflow" },
  "section.body": { type: "richtext", initial: "<p>Create pages, assign layouts, translate content, upload assets, and publish static builds from one place.</p>" },
  "feature.one.title": { type: "text", initial: "Layout keys" },
  "feature.one.body": { type: "text", initial: "Layouts define exactly which fields editors can change." },
  "feature.two.title": { type: "text", initial: "Locale aware" },
  "feature.two.body": { type: "text", initial: "Content resolves through locale, default locale, and layout fallback." },
  "feature.three.title": { type: "text", initial: "Static output" },
  "feature.three.body": { type: "text", initial: "Astro builds deployable HTML with no Node runtime on the public site." },
};

const styles = {
  page: {
    minHeight: "100vh",
    margin: 0,
    background: "#f5f4f0",
    color: "#171717",
    fontFamily:
      "Aptos, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  },
  shell: {
    maxWidth: "1180px",
    margin: "0 auto",
    padding: "32px 24px 72px",
  },
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "24px",
    paddingBottom: "64px",
  },
  brand: {
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
  },
  navLinks: {
    display: "flex",
    gap: "18px",
    fontSize: "14px",
  },
  navLink: {
    color: "#3f3f46",
    textDecoration: "none",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.08fr) minmax(320px, 0.92fr)",
    gap: "56px",
    alignItems: "center",
  },
  kicker: {
    margin: "0 0 18px",
    color: "#0e7490",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
  },
  h1: {
    margin: 0,
    maxWidth: "760px",
    fontSize: "clamp(44px, 7vw, 86px)",
    lineHeight: 0.94,
    letterSpacing: "-0.055em",
  },
  lead: {
    maxWidth: "620px",
    marginTop: "28px",
    color: "#52525b",
    fontSize: "19px",
    lineHeight: 1.7,
  },
  cta: {
    display: "inline-flex",
    alignItems: "center",
    marginTop: "34px",
    minHeight: "44px",
    padding: "0 18px",
    borderRadius: "8px",
    background: "#171717",
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: 700,
    textDecoration: "none",
  },
  mediaFrame: {
    overflow: "hidden",
    minHeight: "520px",
    borderRadius: "14px",
    background: "linear-gradient(135deg, #164e63, #111827)",
    boxShadow: "0 40px 90px -55px rgba(8, 47, 73, 0.7)",
  },
  media: {
    width: "100%",
    height: "100%",
    minHeight: "520px",
    objectFit: "cover",
    display: "block",
    opacity: 0.88,
  },
  section: {
    display: "grid",
    gridTemplateColumns: "0.9fr 1.1fr",
    gap: "56px",
    marginTop: "92px",
    paddingTop: "64px",
    borderTop: "1px solid rgba(24, 24, 27, 0.14)",
  },
  h2: {
    margin: 0,
    fontSize: "clamp(32px, 4vw, 54px)",
    lineHeight: 1,
    letterSpacing: "-0.045em",
  },
  copy: {
    color: "#52525b",
    fontSize: "17px",
    lineHeight: 1.75,
  },
  features: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "1px",
    marginTop: "44px",
    background: "rgba(24, 24, 27, 0.14)",
    border: "1px solid rgba(24, 24, 27, 0.14)",
  },
  feature: {
    minHeight: "180px",
    padding: "28px",
    background: "#f5f4f0",
  },
  featureTitle: {
    margin: "0 0 14px",
    fontSize: "18px",
    fontWeight: 800,
  },
  featureBody: {
    margin: 0,
    color: "#52525b",
    fontSize: "15px",
    lineHeight: 1.65,
  },
} satisfies Record<string, CSSProperties>;

export default function HomeLayout({ content, navigation, settings }: LayoutProps) {
  const brand = settings?.name ?? "AgentiCMS";

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.nav}>
          <div style={styles.brand}>{brand}</div>
          <nav aria-label="Main navigation" style={styles.navLinks}>
            {navigation.map((item) => (
              <a key={item.id} href="#" style={styles.navLink}>
                {item.label}
              </a>
            ))}
          </nav>
        </header>

        <section style={styles.hero}>
          <div>
            <p style={styles.kicker}>{content["hero.kicker"]}</p>
            <h1 style={styles.h1}>{content["hero.title"]}</h1>
            <RichText value={content["hero.body"]} className="lead" />
            <LinkField href={content["hero.cta.link"]} className="hero-cta">
              {content["hero.cta.label"]}
            </LinkField>
          </div>
          <div style={styles.mediaFrame}>
            <ImageField
              src={content["hero.image"]}
              alt={content["hero.title"]}
              className="hero-image"
            />
          </div>
        </section>

        <section style={styles.section}>
          <div>
            <p style={styles.kicker}>{content["section.kicker"]}</p>
            <h2 style={styles.h2}>{content["section.title"]}</h2>
          </div>
          <RichText value={content["section.body"]} />
        </section>

        <section aria-label="Highlights" style={styles.features}>
          {[
            ["feature.one.title", "feature.one.body"],
            ["feature.two.title", "feature.two.body"],
            ["feature.three.title", "feature.three.body"],
          ].map(([titleKey, bodyKey]) => (
            <article key={titleKey} style={styles.feature}>
              <h3 style={styles.featureTitle}>{content[titleKey]}</h3>
              <p style={styles.featureBody}>{content[bodyKey]}</p>
            </article>
          ))}
        </section>
      </div>

      <style>{`
        .lead {
          max-width: 620px;
          margin-top: 28px;
          color: #52525b;
          font-size: 19px;
          line-height: 1.7;
        }

        .lead p {
          margin: 0;
        }

        .hero-cta {
          display: inline-flex;
          align-items: center;
          margin-top: 34px;
          min-height: 44px;
          padding: 0 18px;
          border-radius: 8px;
          background: #171717;
          color: #ffffff;
          font-size: 14px;
          font-weight: 700;
          text-decoration: none;
        }

        .hero-image {
          width: 100%;
          height: 100%;
          min-height: 520px;
          object-fit: cover;
          display: block;
          opacity: 0.88;
        }

        .sf-richtext p {
          margin: 0 0 1em;
        }

        @media (max-width: 860px) {
          main > div {
            padding-inline: 18px !important;
          }

          section {
            grid-template-columns: 1fr !important;
          }

          .hero-image {
            min-height: 320px;
          }
        }
      `}</style>
    </main>
  );
}
