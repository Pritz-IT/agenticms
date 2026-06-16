import { ImageField, LinkField, RichText, type LayoutProps } from "@agenticms/components";

export const keys = {
  "_meta.title": { type: "text", initial: "AgentiCMS" },
  "_meta.description": { type: "text", initial: "A fast CMS for static customer websites." },
  "hero.kicker": { type: "text", initial: "Static CMS" },
  "hero.title": { type: "text", initial: "Launch polished websites without touching Git" },
  "hero.body": { type: "richtext", initial: "<p>AgentiCMS gives editors a clean admin UI while the public website stays static, fast, and simple to host.</p>" },
  "hero.image": { type: "image", initial: "/assets/agenticms-hero.svg" },
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

function splitHeadline(title: string): { lead: string; emph: string } {
  const parts = title.trim().split(/\s+/);
  if (parts.length < 2) return { lead: "", emph: title };
  const emph = parts.slice(-2).join(" ");
  const lead = parts.slice(0, -2).join(" ");
  return { lead, emph };
}

export default function HomeLayout({ content, navigation, settings }: LayoutProps) {
  const brand = settings?.name ?? "AgentiCMS";
  const year = new Date().getFullYear();
  const headline = splitHeadline(content["hero.title"]);

  return (
    <main className="sf-page" data-scrolled="false">
      <script dangerouslySetInnerHTML={{ __html: `(()=>{const m=document.currentScript.parentElement;const u=()=>{m.dataset.scrolled=window.scrollY>80?'true':'false'};u();addEventListener('scroll',u,{passive:true})})();` }} />

      {/* Scroll progress bar */}
      <div className="sf-scroll-progress" aria-hidden="true" />

      {/* Editorial nav — top-level stacking context, slides in on scroll */}
      <header className="sf-nav-wrap" data-scroll-reveal>
          <div className="sf-nav">
            <a href="/" className="sf-brand">
              <span className="sf-brand-glyph" aria-hidden="true">
                <span className="sf-brand-glyph-ring" />
                <span className="sf-brand-glyph-dot" />
              </span>
              <span className="sf-brand-name">{brand}</span>
              <span className="sf-brand-tag">©</span>
            </a>

            <nav aria-label="Main navigation" className="sf-nav-links">
              {navigation.length > 0
                ? navigation.map((item) => (
                    <a key={item.id} href="#" className="sf-nav-link">
                      <span className="sf-nav-link-num">/</span>
                      <span className="sf-nav-link-label">{item.label}</span>
                    </a>
                  ))
                : (
                  <>
                    <a href="#features" className="sf-nav-link"><span className="sf-nav-link-num">/</span><span className="sf-nav-link-label">Features</span></a>
                    <a href="#" className="sf-nav-link"><span className="sf-nav-link-num">/</span><span className="sf-nav-link-label">Docs</span></a>
                    <a href="https://github.com" className="sf-nav-link"><span className="sf-nav-link-num">/</span><span className="sf-nav-link-label">GitHub</span></a>
                    <a href="#" className="sf-nav-link"><span className="sf-nav-link-num">/</span><span className="sf-nav-link-label">Changelog</span></a>
                  </>
                )}
            </nav>

            <div className="sf-nav-actions">
              <a href="#" className="sf-nav-link sf-nav-link--quiet">Sign in</a>
              <LinkField href={content["hero.cta.link"]} className="sf-nav-cta">
                <span>{content["hero.cta.label"]}</span>
                <span className="sf-arrow" aria-hidden="true">→</span>
              </LinkField>
            </div>
          </div>
        </header>

      {/* Hero — atmospheric, full-bleed */}
      <section className="sf-hero-dark">
        {/* Atmospheric bg — radial mesh + grain + grid */}
        <div className="sf-hero-bg" aria-hidden="true">
          <div className="sf-hero-orb sf-hero-orb--a" />
          <div className="sf-hero-orb sf-hero-orb--b" />
          <div className="sf-hero-orb sf-hero-orb--c" />
          <div className="sf-hero-grid" />
          <div className="sf-hero-noise" />
          <div className="sf-hero-vignette" />
        </div>

        {/* Hero content — centered */}
        <div className="sf-hero-inner">
          <a href="#features" className="sf-hero-pill sf-stagger" style={{ "--d": "0ms" } as React.CSSProperties}>
            <span className="sf-hero-pill-tag">v0.1</span>
            <span className="sf-hero-pill-divider" />
            <span className="sf-hero-pill-text">Self-hosted · open beta</span>
            <span className="sf-arrow" aria-hidden="true">→</span>
          </a>

          <h1 className="sf-h1 sf-stagger" style={{ "--d": "100ms" } as React.CSSProperties}>
            {headline.lead && <>{headline.lead}<br /></>}
            <em className="sf-h1-emph">{headline.emph}</em>
            <span className="sf-h1-underline" aria-hidden="true" />
          </h1>

          <div className="sf-stagger" style={{ "--d": "200ms" } as React.CSSProperties}>
            <RichText value={content["hero.body"]} className="sf-lead" />
          </div>

          <div className="sf-hero-actions sf-stagger" style={{ "--d": "300ms" } as React.CSSProperties}>
            <LinkField href={content["hero.cta.link"]} className="sf-cta sf-cta--primary">
              <span className="sf-cta-shine" aria-hidden="true" />
              <span>{content["hero.cta.label"]}</span>
              <span className="sf-arrow" aria-hidden="true">→</span>
            </LinkField>
            <code className="sf-cta sf-cta--terminal">
              <span className="sf-term-prompt">$</span>
              <span className="sf-term-cmd">docker run agenticms</span>
              <span className="sf-term-copy" aria-hidden="true">⌘C</span>
            </code>
          </div>

          {/* Deploy targets strip */}
          <div className="sf-deploy sf-stagger" style={{ "--d": "400ms" } as React.CSSProperties}>
            <span className="sf-deploy-label">Deploys to any static host</span>
            <ul className="sf-deploy-list">
              <li className="sf-deploy-item">S3</li>
              <li className="sf-deploy-divider" aria-hidden="true" />
              <li className="sf-deploy-item">Cloudflare</li>
              <li className="sf-deploy-divider" aria-hidden="true" />
              <li className="sf-deploy-item">Pages</li>
              <li className="sf-deploy-divider" aria-hidden="true" />
              <li className="sf-deploy-item">Netlify</li>
              <li className="sf-deploy-divider" aria-hidden="true" />
              <li className="sf-deploy-item">Nginx</li>
              <li className="sf-deploy-divider" aria-hidden="true" />
              <li className="sf-deploy-item">Vercel</li>
            </ul>
          </div>

        </div>

        <span className="sf-hero-scroll" aria-hidden="true">
          <span className="sf-hero-scroll-text">Scroll</span>
          <span className="sf-hero-scroll-line" />
        </span>
      </section>

      <div className="sf-shell">

        {/* Slot machine + Pipeline */}
        <section className="sf-anchor" aria-label="Live demonstration">
          <div className="sf-anchor-marker">
            <span className="sf-status-dot" />
            <span className="sf-anchor-tag">Live</span>
            <span className="sf-anchor-divider" />
            <span className="sf-anchor-meta">demo · running</span>
          </div>

          <div className="sf-slot" aria-label="It's static, fast, type-safe, locale-aware, composable, yours">
            <span className="sf-slot-prefix">It's</span>
            <span className="sf-slot-window" aria-hidden="true">
              <span className="sf-slot-bracket sf-slot-bracket--l">[</span>
              <span className="sf-slot-track">
                <span className="sf-slot-word">static.</span>
                <span className="sf-slot-word">fast.</span>
                <span className="sf-slot-word">type-safe.</span>
                <span className="sf-slot-word">locale-aware.</span>
                <span className="sf-slot-word">composable.</span>
                <span className="sf-slot-word">yours.</span>
                <span className="sf-slot-word">static.</span>
              </span>
              <span className="sf-slot-bracket sf-slot-bracket--r">]</span>
            </span>
          </div>

          <div className="sf-pipeline" aria-hidden="true">
            <div className="sf-pipe-rail">
              <span className="sf-pipe-pulse" />
            </div>
            <ol className="sf-pipe-steps">
              <li className="sf-pipe-step">
                <span className="sf-pipe-node" />
                <span className="sf-pipe-key">01</span>
                <span className="sf-pipe-label">Edit</span>
                <span className="sf-pipe-meta">admin</span>
              </li>
              <li className="sf-pipe-step">
                <span className="sf-pipe-node" />
                <span className="sf-pipe-key">02</span>
                <span className="sf-pipe-label">Build</span>
                <span className="sf-pipe-meta">astro</span>
              </li>
              <li className="sf-pipe-step">
                <span className="sf-pipe-node" />
                <span className="sf-pipe-key">03</span>
                <span className="sf-pipe-label">Deploy</span>
                <span className="sf-pipe-meta">edge</span>
              </li>
              <li className="sf-pipe-step">
                <span className="sf-pipe-node sf-pipe-node--end" />
                <span className="sf-pipe-key">04</span>
                <span className="sf-pipe-label">Serve</span>
                <span className="sf-pipe-meta">~ms</span>
              </li>
            </ol>
          </div>
        </section>

        <section className="sf-section sf-reveal" id="features">
          <div className="sf-section-header">
            <span className="sf-pill sf-pill--muted">
              <span className="sf-pill-dot" />
              {content["section.kicker"]}
            </span>
            <h2 className="sf-h2">{content["section.title"]}</h2>
          </div>
          <div className="sf-section-body">
            <RichText value={content["section.body"]} className="sf-copy" />
          </div>
        </section>

        <section aria-label="Highlights" className="sf-features">
          {[
            ["feature.one.title", "feature.one.body", "01"],
            ["feature.two.title", "feature.two.body", "02"],
            ["feature.three.title", "feature.three.body", "03"],
          ].map(([titleKey, bodyKey, num], i) => (
            <article
              key={titleKey}
              className="sf-feature sf-reveal"
              style={{ "--i": i } as React.CSSProperties}
            >
              <div className="sf-feature-border" aria-hidden="true" />
              <div className="sf-feature-inner">
                <span className="sf-feature-num">
                  <span>{num}</span>
                </span>
                <h3 className="sf-feature-title">{content[titleKey]}</h3>
                <p className="sf-feature-body">{content[bodyKey]}</p>
                <span className="sf-feature-arrow" aria-hidden="true">→</span>
              </div>
            </article>
          ))}
        </section>

        <footer className="sf-footer">
          <div className="sf-footer-left">
            <span className="sf-brand-mark">
              <span className="sf-brand-dot" />
            </span>
            <span>{brand}</span>
          </div>
          <span className="sf-footer-meta">© {year} · Built with AgentiCMS</span>
        </footer>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @import url("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,200..800&family=Geist+Mono:wght@400;500&display=swap");

        @property --sf-angle {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }
        @property --sf-shine {
          syntax: "<percentage>";
          inherits: false;
          initial-value: -120%;
        }

        :root {
          /* Warm cream light palette */
          --bg: oklch(97.5% 0.008 80);
          --bg-2: oklch(95% 0.01 80);
          --surface: oklch(99.5% 0.003 80);
          --ink: oklch(16% 0.02 270);
          --ink-soft: oklch(26% 0.018 270);
          --muted: oklch(42% 0.015 270);
          --subtle: oklch(60% 0.012 270);
          --line: oklch(16% 0.02 270 / 0.08);
          --line-strong: oklch(16% 0.02 270 / 0.18);

          /* Brand accent — deep teal */
          --accent: oklch(45% 0.1 220);
          --accent-soft: oklch(45% 0.1 220 / 0.08);
          --accent-glow: oklch(70% 0.16 220);
          --accent-warm: oklch(60% 0.18 30);

          --focus: oklch(55% 0.16 220);
          --radius: 20px;
          --shadow-soft: 0 1px 2px oklch(16% 0.02 270 / 0.04), 0 8px 28px -14px oklch(16% 0.02 270 / 0.12);
          --shadow-lift: 0 16px 50px -22px oklch(30% 0.06 220 / 0.4);
          --font-sans: "Bricolage Grotesque", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          --font-mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;
        }

        .sf-page {
          position: relative;
          min-height: 100vh;
          margin: 0;
          background: var(--bg);
          color: var(--ink);
          font-family: var(--font-sans);
          font-variation-settings: "wdth" 100, "opsz" 14;
          font-feature-settings: "ss01", "ss02", "cv11";
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
          overflow-x: hidden;
        }

        /* Focus rings — brand-tinted, high visibility, only on keyboard */
        .sf-page :focus { outline: none; }
        .sf-page :focus-visible {
          outline: 2px solid var(--focus);
          outline-offset: 3px;
          border-radius: 6px;
        }
        .sf-cta:focus-visible,
        .sf-nav-cta:focus-visible {
          outline-offset: 3px;
        }

        /* ── Scroll Progress ── */
        .sf-scroll-progress {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(to right, var(--accent-glow), var(--accent), var(--accent-glow));
          background-size: 200% 100%;
          transform-origin: 0 50%;
          transform: scaleX(0);
          z-index: 100;
          animation: sf-progress linear, sf-shimmer 4s linear infinite;
          animation-timeline: scroll(root);
        }
        @keyframes sf-progress { to { transform: scaleX(1); } }
        @keyframes sf-shimmer { to { background-position: -200% 0; } }

        /* ─────────────────────── LIGHT HERO ─────────────────────── */
        .sf-hero-dark {
          position: relative;
          isolation: isolate;
          color: var(--ink);
          background: var(--bg);
          overflow: hidden;
          padding-bottom: clamp(72px, 8vw, 120px);
        }

        /* Atmospheric soft pastel background */
        .sf-hero-bg {
          position: absolute;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          overflow: hidden;
        }
        .sf-hero-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(90px);
          will-change: transform;
        }
        .sf-hero-orb--a {
          top: -10%;
          left: -8%;
          width: 56vw;
          height: 56vw;
          max-width: 920px;
          max-height: 920px;
          background: radial-gradient(circle, oklch(82% 0.12 220 / 0.45), transparent 65%);
          animation: sf-orb-a 22s ease-in-out infinite alternate;
        }
        .sf-hero-orb--b {
          top: 5%;
          right: -10%;
          width: 50vw;
          height: 50vw;
          max-width: 820px;
          max-height: 820px;
          background: radial-gradient(circle, oklch(85% 0.1 60 / 0.5), transparent 65%);
          animation: sf-orb-b 28s ease-in-out infinite alternate;
        }
        .sf-hero-orb--c {
          bottom: -25%;
          left: 22%;
          width: 50vw;
          height: 50vw;
          max-width: 800px;
          max-height: 800px;
          background: radial-gradient(circle, oklch(88% 0.08 320 / 0.4), transparent 65%);
          animation: sf-orb-c 32s ease-in-out infinite alternate;
        }
        @keyframes sf-orb-a {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(40px, 60px) scale(1.1); }
        }
        @keyframes sf-orb-b {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(-50px, 30px) scale(0.95); }
        }
        @keyframes sf-orb-c {
          0% { transform: translate(0, 0) scale(0.95); }
          100% { transform: translate(40px, -40px) scale(1.08); }
        }
        .sf-hero-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(to right, oklch(16% 0.02 270 / 0.05) 1px, transparent 1px),
            linear-gradient(to bottom, oklch(16% 0.02 270 / 0.05) 1px, transparent 1px);
          background-size: 56px 56px;
          mask-image: radial-gradient(ellipse at 50% 35%, oklch(0% 0 0) 25%, transparent 75%);
          -webkit-mask-image: radial-gradient(ellipse at 50% 35%, oklch(0% 0 0) 25%, transparent 75%);
        }
        .sf-hero-noise {
          position: absolute;
          inset: 0;
          opacity: 0.04;
          mix-blend-mode: multiply;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
        }
        .sf-hero-vignette {
          position: absolute;
          inset: 0;
          background: linear-gradient(to bottom, transparent 60%, var(--bg) 100%);
        }

        /* ── Nav (editorial, typographic, smooth reveal on scroll) ── */
        .sf-nav-wrap {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 200;
          padding: 18px 0 0;
          opacity: 0;
          transform: translateY(-110%);
          pointer-events: none;
          transition:
            opacity 500ms cubic-bezier(0.2, 0.8, 0.2, 1),
            transform 600ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        [data-scrolled="true"] .sf-nav-wrap {
          opacity: 1;
          transform: translateY(0);
          pointer-events: auto;
        }
        .sf-nav-wrap > * { pointer-events: auto; }

        /* No veil — pill is opaque enough to stand alone, content scrolls cleanly behind it */
        .sf-nav {
          max-width: 1240px;
          margin: 0 24px;
          padding: 14px 18px 14px 20px;
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 32px;
          border-radius: 18px;
          background: oklch(99% 0.003 80 / 0.98);
          backdrop-filter: saturate(120%) blur(6px);
          -webkit-backdrop-filter: saturate(120%) blur(6px);
          box-shadow:
            0 0 0 1px oklch(16% 0.02 270 / 0.06),
            0 1px 0 oklch(100% 0 0 / 0.9) inset,
            0 8px 24px -12px oklch(16% 0.02 270 / 0.12),
            0 2px 6px -2px oklch(16% 0.02 270 / 0.06);
        }
        @media (min-width: 1340px) {
          .sf-nav { margin: 0 auto; }
        }

        /* Brand — typographic, no dark square */
        .sf-brand {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          color: var(--ink);
          text-decoration: none;
          font-size: 18px;
          font-weight: 600;
          font-variation-settings: "wdth" 84, "opsz" 24;
          letter-spacing: -0.025em;
          line-height: 1;
        }
        .sf-brand-glyph {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
        }
        .sf-brand-glyph-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 1.5px solid var(--accent);
          opacity: 0.55;
          animation: sf-glyph-rotate 12s linear infinite;
        }
        .sf-brand-glyph-ring::before {
          content: "";
          position: absolute;
          top: -2px;
          left: 50%;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--accent);
          transform: translateX(-50%);
        }
        @keyframes sf-glyph-rotate { to { transform: rotate(360deg); } }
        .sf-brand-glyph-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          box-shadow: 0 0 8px oklch(70% 0.16 220 / 0.5);
        }
        .sf-brand-name {
          color: var(--ink);
        }
        .sf-brand-tag {
          align-self: flex-start;
          margin-top: 1px;
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 400;
          color: var(--subtle);
          letter-spacing: 0.04em;
        }

        /* Nav links — mono caps, animated draw-in underline */
        .sf-nav-links {
          display: flex;
          align-items: center;
          gap: 4px;
          justify-self: center;
        }
        .sf-nav-link {
          position: relative;
          display: inline-flex;
          align-items: baseline;
          gap: 4px;
          padding: 8px 12px;
          color: var(--muted);
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 500;
          text-decoration: none;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          transition: color 240ms ease;
        }
        .sf-nav-link::after {
          content: "";
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: 4px;
          height: 1px;
          background: var(--ink);
          transform: scaleX(0);
          transform-origin: left center;
          transition: transform 320ms cubic-bezier(0.65, 0, 0.35, 1);
        }
        .sf-nav-link:hover {
          color: var(--ink);
        }
        .sf-nav-link:hover::after {
          transform: scaleX(1);
        }
        .sf-nav-link-num {
          color: var(--accent);
          font-weight: 400;
          opacity: 0.7;
          transition: opacity 240ms ease;
        }
        .sf-nav-link:hover .sf-nav-link-num { opacity: 1; }
        .sf-nav-link-label { letter-spacing: 0.06em; }

        .sf-nav-link--quiet {
          font-family: var(--font-sans);
          font-size: 13px;
          letter-spacing: -0.005em;
          text-transform: none;
          font-weight: 500;
        }
        .sf-nav-link--quiet::after { display: none; }

        .sf-nav-actions {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        @keyframes sf-ping {
          0% { transform: scale(0.6); opacity: 0.5; }
          75%, 100% { transform: scale(2); opacity: 0; }
        }

        .sf-nav-cta {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 999px;
          background: var(--ink);
          color: #fff;
          font-size: 13px;
          font-weight: 500;
          text-decoration: none;
          overflow: hidden;
          transition: transform 220ms ease, background 220ms ease;
        }
        .sf-nav-cta::before {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(110deg, transparent 30%, oklch(100% 0 0 / 0.18) 50%, transparent 70%);
          transform: translateX(-100%);
          transition: transform 600ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .sf-nav-cta:hover { transform: translateY(-1px); background: var(--accent); }
        .sf-nav-cta:hover::before { transform: translateX(100%); }
        .sf-nav-cta > * { position: relative; z-index: 1; }

        /* ── Shell ── */
        .sf-shell {
          position: relative;
          z-index: 1;
          max-width: 1180px;
          margin: 0 auto;
          padding: 96px 24px 48px;
        }

        /* ── Stagger entrance ── */
        .sf-stagger {
          opacity: 0;
          transform: translateY(20px);
          animation: sf-fade-up 800ms cubic-bezier(0.2, 0.8, 0.2, 1) var(--d, 0ms) forwards;
        }
        @keyframes sf-fade-up {
          to { opacity: 1; transform: translateY(0); }
        }

        /* ── Reveal on scroll (CSS scroll-timeline) ── */
        .sf-reveal {
          animation: sf-reveal-in linear both;
          animation-timeline: view();
          animation-range: entry 0% cover 35%;
        }
        @keyframes sf-reveal-in {
          from {
            opacity: 0;
            transform: translateY(40px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        /* ── Hero (centered, dark) ── */
        .sf-hero-inner {
          position: relative;
          max-width: 1080px;
          margin: 0 auto;
          padding: clamp(64px, 10vw, 140px) 24px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        /* Hero version pill */
        .sf-hero-pill {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 6px 14px 6px 8px;
          border: 1px solid var(--line-strong);
          border-radius: 999px;
          background: oklch(99% 0.003 80 / 0.7);
          backdrop-filter: blur(12px);
          color: var(--ink-soft);
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.02em;
          text-decoration: none;
          transition: border-color 240ms ease, background 240ms ease, transform 240ms ease;
        }
        .sf-hero-pill:hover {
          border-color: oklch(45% 0.1 220 / 0.4);
          background: oklch(99% 0.003 80 / 0.95);
          transform: translateY(-1px);
        }
        .sf-hero-pill-tag {
          padding: 3px 8px;
          border-radius: 999px;
          background: var(--accent);
          color: oklch(98% 0.005 220);
          font-size: 11px;
          font-weight: 500;
        }
        .sf-hero-pill-divider {
          width: 1px;
          height: 14px;
          background: var(--line-strong);
        }
        .sf-hero-pill-text { color: var(--muted); }
        .sf-hero-pill .sf-arrow { color: var(--muted); transition: transform 220ms ease, color 220ms ease; }
        .sf-hero-pill:hover .sf-arrow { color: var(--accent-glow); transform: translateX(3px); }

        /* Pill (existing, used in light sections) */
        .sf-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px 6px 10px;
          border: 1px solid var(--line);
          border-radius: 999px;
          background: oklch(99% 0.003 220 / 0.65);
          color: var(--accent);
          font-family: var(--font-mono);
          font-size: 11.5px;
          font-weight: 500;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          backdrop-filter: blur(8px);
        }
        .sf-pill--muted { color: var(--muted); }
        .sf-pill-dot {
          position: relative;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
        }
        .sf-pill-dot::after {
          content: "";
          position: absolute;
          inset: -3px;
          border-radius: 50%;
          background: var(--accent);
          opacity: 0.3;
          animation: sf-pulse 2.4s ease-in-out infinite;
        }
        @keyframes sf-pulse {
          0%, 100% { transform: scale(1); opacity: 0.35; }
          50% { transform: scale(1.6); opacity: 0; }
        }

        .sf-h1 {
          position: relative;
          margin: 32px 0 0;
          max-width: 14ch;
          font-size: clamp(56px, 10vw, 132px);
          line-height: 0.94;
          letter-spacing: -0.05em;
          font-weight: 600;
          font-variation-settings: "wdth" 82, "opsz" 96;
          color: var(--ink);
          text-wrap: balance;
        }
        .sf-h1-emph {
          position: relative;
          font-style: italic;
          font-weight: 400;
          font-variation-settings: "wdth" 88, "opsz" 96;
          color: var(--accent);
          padding: 0 0.04em;
          white-space: nowrap;
        }
        /* Animated underline drawing in beneath the italic word */
        .sf-h1-underline {
          position: absolute;
          left: 50%;
          bottom: -0.06em;
          width: clamp(180px, 22vw, 300px);
          height: 0.08em;
          background: linear-gradient(90deg, transparent, var(--accent), var(--accent-glow), var(--accent), transparent);
          transform: translateX(-50%) scaleX(0);
          transform-origin: 50% 50%;
          opacity: 0;
          animation: sf-draw-underline 1.4s cubic-bezier(0.65, 0, 0.35, 1) 0.9s forwards,
                     sf-shimmer-line 4s linear 2.4s infinite;
          background-size: 200% 100%;
        }
        @keyframes sf-draw-underline {
          0% { opacity: 0; transform: translateX(-50%) scaleX(0); }
          50% { opacity: 1; }
          100% { opacity: 1; transform: translateX(-50%) scaleX(1); }
        }
        @keyframes sf-shimmer-line {
          to { background-position: -200% 0; }
        }

        .sf-lead {
          max-width: 50ch;
          margin: 28px auto 0;
          color: var(--muted);
          font-size: clamp(17px, 1.6vw, 20px);
          line-height: 1.55;
          text-wrap: pretty;
        }
        .sf-lead p { margin: 0; }

        .sf-hero-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 12px;
          margin-top: 40px;
        }
        .sf-cta {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 48px;
          padding: 0 22px;
          border-radius: 14px;
          font-size: 14px;
          font-weight: 500;
          letter-spacing: -0.005em;
          text-decoration: none;
          overflow: hidden;
          transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 280ms cubic-bezier(0.2, 0.8, 0.2, 1), background 200ms ease;
        }
        .sf-cta:active { transform: translateY(0) scale(0.98); transition-duration: 80ms; }
        .sf-cta--primary {
          background: oklch(98% 0.005 220);
          color: oklch(18% 0.015 220);
          box-shadow:
            0 0 0 1px oklch(100% 0 0 / 0.1) inset,
            0 12px 32px -12px oklch(70% 0.16 220 / 0.45);
        }
        .sf-cta--primary:hover {
          transform: translateY(-2px);
          box-shadow:
            0 0 0 1px oklch(100% 0 0 / 0.2) inset,
            0 18px 48px -16px oklch(70% 0.16 220 / 0.6);
        }
        .sf-cta-shine {
          position: absolute;
          inset: 0;
          background: linear-gradient(110deg, transparent 35%, oklch(100% 0 0 / 0.18) 50%, transparent 65%);
          transform: translateX(var(--sf-shine));
          transition: --sf-shine 800ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .sf-cta--primary:hover .sf-cta-shine { --sf-shine: 120%; }
        .sf-cta--primary > span:not(.sf-cta-shine) { position: relative; z-index: 1; }
        .sf-cta--ghost {
          background: oklch(99% 0.003 220 / 0.5);
          color: var(--ink);
          border: 1px solid var(--line-strong);
          backdrop-filter: blur(8px);
        }
        .sf-cta--ghost:hover {
          background: oklch(99% 0.003 220 / 0.9);
          transform: translateY(-2px);
        }

        /* Terminal CTA — secondary, light hero */
        .sf-cta--terminal {
          gap: 12px;
          padding: 0 16px;
          border: 1px solid var(--line-strong);
          border-radius: 14px;
          background: oklch(16% 0.02 270);
          color: oklch(98% 0.005 220);
          font-family: var(--font-mono);
          font-size: 13px;
          cursor: pointer;
          user-select: all;
          box-shadow:
            0 0 0 1px oklch(100% 0 0 / 0.06) inset,
            0 12px 32px -16px oklch(16% 0.02 270 / 0.4);
        }
        .sf-cta--terminal:hover {
          background: oklch(22% 0.02 270);
          transform: translateY(-1px);
          box-shadow:
            0 0 0 1px oklch(100% 0 0 / 0.1) inset,
            0 18px 40px -16px oklch(16% 0.02 270 / 0.5);
        }
        .sf-term-prompt { color: var(--accent-glow); font-weight: 500; }
        .sf-term-cmd { color: oklch(95% 0.005 220); }
        .sf-term-copy {
          margin-left: 4px;
          padding: 3px 8px;
          border-radius: 6px;
          background: oklch(100% 0 0 / 0.08);
          color: oklch(70% 0.012 220);
          font-size: 11px;
          letter-spacing: 0.04em;
          transition: background 220ms ease, color 220ms ease;
        }
        .sf-cta--terminal:hover .sf-term-copy {
          background: var(--accent-glow);
          color: oklch(16% 0.02 270);
        }

        .sf-arrow {
          display: inline-block;
          transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .sf-cta:hover .sf-arrow { transform: translateX(4px); }
        .sf-cta:hover .sf-arrow--down { transform: translateY(3px); }

        /* Deploy targets strip */
        .sf-deploy {
          margin-top: clamp(48px, 6vw, 80px);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 18px;
        }
        .sf-deploy-label {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--subtle);
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .sf-deploy-list {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          justify-content: center;
          gap: 22px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .sf-deploy-item {
          font-family: var(--font-mono);
          font-size: 14px;
          font-weight: 500;
          color: var(--ink-soft);
          letter-spacing: -0.01em;
          opacity: 0.85;
          transition: opacity 220ms ease, color 220ms ease;
        }
        .sf-deploy-item:hover {
          opacity: 1;
          color: var(--accent-glow);
        }
        .sf-deploy-divider {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--line-strong);
        }

        /* Scroll indicator — bottom of hero, centered */
        .sf-hero-scroll {
          position: absolute;
          bottom: 28px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          color: var(--subtle);
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          pointer-events: none;
        }
        .sf-hero-scroll-line {
          width: 1px;
          height: 28px;
          background: linear-gradient(to bottom, var(--ink-soft), transparent);
          transform-origin: top center;
          animation: sf-scroll-pulse 2.2s ease-in-out infinite;
        }
        @keyframes sf-scroll-pulse {
          0% { opacity: 0; transform: scaleY(0.3); }
          50% { opacity: 0.7; transform: scaleY(1); }
          100% { opacity: 0; transform: scaleY(0.3); transform-origin: bottom center; }
        }
        .sf-media-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, transparent 55%, oklch(20% 0.04 220 / 0.45) 100%);
          pointer-events: none;
        }
        .sf-media-chip {
          position: absolute;
          left: 18px;
          bottom: 18px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          border-radius: 999px;
          background: oklch(18% 0.015 220 / 0.7);
          backdrop-filter: blur(12px);
          color: oklch(98% 0.003 220);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.02em;
        }

        /* ── Slot Machine + Pipeline ── */
        .sf-anchor {
          position: relative;
          margin-top: 140px;
          padding: 56px 0 0;
          border-top: 1px solid var(--line);
        }
        .sf-anchor-marker {
          display: flex;
          align-items: center;
          gap: 12px;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--subtle);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .sf-anchor-tag {
          color: oklch(38% 0.12 145);
          font-weight: 500;
        }
        .sf-anchor-divider {
          width: 24px;
          height: 1px;
          background: var(--line-strong);
        }
        .sf-anchor-meta {
          color: var(--subtle);
        }

        /* Slot machine */
        .sf-slot {
          margin-top: 36px;
          display: flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: clamp(16px, 2vw, 32px);
          font-size: clamp(48px, 9vw, 132px);
          line-height: 1;
          letter-spacing: -0.05em;
          font-weight: 500;
          font-variation-settings: "wdth" 84, "opsz" 96;
          color: var(--ink);
        }
        .sf-slot-prefix {
          color: var(--ink-soft);
          font-variation-settings: "wdth" 92, "opsz" 96;
          font-style: italic;
          font-weight: 400;
        }
        .sf-slot-window {
          position: relative;
          display: inline-flex;
          align-items: baseline;
          height: 1.05em;
          overflow: hidden;
          padding: 0 0.06em 0.08em;
          gap: 0.05em;
        }
        .sf-slot-bracket {
          display: inline-block;
          color: var(--accent);
          font-weight: 400;
          font-variation-settings: "wdth" 75, "opsz" 96;
          opacity: 0.55;
          animation: sf-bracket-pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .sf-slot-bracket--r { animation-delay: 1.2s; }
        @keyframes sf-bracket-pulse {
          0%, 100% { opacity: 0.4; transform: translateY(0); }
          50% { opacity: 0.85; transform: translateY(-0.04em); }
        }
        .sf-slot-track {
          display: flex;
          flex-direction: column;
          line-height: 1.05;
          color: var(--accent);
          font-variation-settings: "wdth" 88, "opsz" 96;
          font-weight: 600;
          animation: sf-slot 14s cubic-bezier(0.85, 0, 0.15, 1) infinite;
        }
        .sf-slot-word {
          display: block;
          height: 1.05em;
        }
        @keyframes sf-slot {
          /* 6 stops × 100/6 ≈ 16.67% each. Hold each word, then snap */
          0%, 12% { transform: translateY(0); }
          16.67%, 28.67% { transform: translateY(-1.05em); }
          33.33%, 45.33% { transform: translateY(-2.10em); }
          50%, 62% { transform: translateY(-3.15em); }
          66.67%, 78.67% { transform: translateY(-4.20em); }
          83.33%, 95.33% { transform: translateY(-5.25em); }
          100% { transform: translateY(-6.30em); }
        }

        /* Pipeline */
        .sf-pipeline {
          position: relative;
          margin-top: 80px;
          padding: 36px 0 8px;
        }
        .sf-pipe-rail {
          position: absolute;
          left: 0;
          right: 0;
          top: 56px;
          height: 1px;
          background: var(--line-strong);
          overflow: hidden;
        }
        .sf-pipe-pulse {
          position: absolute;
          top: -1px;
          left: 0;
          height: 3px;
          width: 18%;
          background: linear-gradient(90deg, transparent, var(--accent), oklch(70% 0.16 220), var(--accent), transparent);
          filter: drop-shadow(0 0 6px oklch(58% 0.12 220 / 0.6));
          animation: sf-pulse-travel 4.2s cubic-bezier(0.65, 0, 0.35, 1) infinite;
        }
        @keyframes sf-pulse-travel {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(calc(100vw + 100%)); }
        }

        .sf-pipe-steps {
          position: relative;
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 24px;
        }
        .sf-pipe-step {
          position: relative;
          display: grid;
          grid-template-rows: auto auto auto auto;
          gap: 12px;
          padding-top: 0;
          align-items: start;
        }
        .sf-pipe-node {
          position: relative;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--bg);
          border: 1.5px solid var(--line-strong);
          z-index: 2;
          margin-bottom: 28px;
          transition: border-color 280ms ease, background 280ms ease, box-shadow 280ms ease;
        }
        .sf-pipe-node::before {
          content: "";
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          background: var(--accent);
          opacity: 0;
          animation: sf-node-flash 4.2s ease-in-out infinite;
        }
        .sf-pipe-step:nth-child(1) .sf-pipe-node::before { animation-delay: 0.4s; }
        .sf-pipe-step:nth-child(2) .sf-pipe-node::before { animation-delay: 1.4s; }
        .sf-pipe-step:nth-child(3) .sf-pipe-node::before { animation-delay: 2.4s; }
        .sf-pipe-step:nth-child(4) .sf-pipe-node::before { animation-delay: 3.4s; }
        @keyframes sf-node-flash {
          0%, 100% { opacity: 0; transform: scale(0.6); }
          5% { opacity: 0.4; transform: scale(1.2); }
          15% { opacity: 0; transform: scale(2); }
        }
        .sf-pipe-step:nth-child(1) .sf-pipe-node {
          animation: sf-node-fill 4.2s ease-in-out infinite;
          animation-delay: 0.3s;
        }
        .sf-pipe-step:nth-child(2) .sf-pipe-node {
          animation: sf-node-fill 4.2s ease-in-out infinite;
          animation-delay: 1.3s;
        }
        .sf-pipe-step:nth-child(3) .sf-pipe-node {
          animation: sf-node-fill 4.2s ease-in-out infinite;
          animation-delay: 2.3s;
        }
        .sf-pipe-step:nth-child(4) .sf-pipe-node {
          animation: sf-node-fill 4.2s ease-in-out infinite;
          animation-delay: 3.3s;
        }
        @keyframes sf-node-fill {
          0%, 100% {
            background: var(--bg);
            border-color: var(--line-strong);
            box-shadow: none;
          }
          5%, 25% {
            background: var(--accent);
            border-color: var(--accent);
            box-shadow: 0 0 0 4px oklch(48% 0.09 220 / 0.18);
          }
        }

        .sf-pipe-key {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--subtle);
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-feature-settings: "tnum";
        }
        .sf-pipe-label {
          font-size: 22px;
          font-weight: 500;
          font-variation-settings: "wdth" 88;
          letter-spacing: -0.02em;
          color: var(--ink);
        }
        .sf-pipe-meta {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--muted);
          letter-spacing: 0.02em;
        }

        /* ── Section ── */
        .sf-section {
          display: grid;
          grid-template-columns: 0.85fr 1.15fr;
          gap: 64px;
          margin-top: 96px;
          padding-top: 16px;
        }
        .sf-section-header {
          display: flex;
          flex-direction: column;
          gap: 22px;
        }
        .sf-h2 {
          margin: 0;
          max-width: 16ch;
          font-size: clamp(34px, 4.4vw, 60px);
          line-height: 1.02;
          letter-spacing: -0.04em;
          font-weight: 500;
          font-variation-settings: "wdth" 90, "opsz" 60;
          color: var(--ink);
          text-wrap: balance;
        }
        .sf-copy {
          max-width: 65ch;
          color: var(--muted);
          font-size: 17px;
          line-height: 1.7;
          text-wrap: pretty;
        }
        .sf-copy p { margin: 0 0 1em; }
        .sf-copy p:last-child { margin-bottom: 0; }

        /* ── Features ── */
        .sf-features {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
          margin-top: 56px;
        }
        .sf-feature {
          position: relative;
          border-radius: var(--radius);
          background: var(--surface);
          isolation: isolate;
          transition: transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1);
          animation-delay: calc(var(--i) * 80ms);
        }
        .sf-feature-border {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(180deg, var(--line-strong), var(--line));
          -webkit-mask: linear-gradient(oklch(0% 0 0) 0 0) content-box, linear-gradient(oklch(0% 0 0) 0 0);
          mask: linear-gradient(oklch(0% 0 0) 0 0) content-box, linear-gradient(oklch(0% 0 0) 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
          transition: background 320ms ease;
          z-index: 1;
        }
        .sf-feature:hover .sf-feature-border {
          background: linear-gradient(180deg, oklch(48% 0.09 220 / 0.45), var(--line-strong));
        }
        .sf-feature-inner {
          position: relative;
          z-index: 2;
          padding: 30px 28px 32px;
          border-radius: inherit;
        }
        .sf-feature-inner::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: linear-gradient(135deg, oklch(48% 0.09 220 / 0.05), transparent 55%);
          opacity: 0;
          transition: opacity 320ms ease;
          pointer-events: none;
        }
        .sf-feature:hover {
          transform: translateY(-4px);
        }
        .sf-feature:hover .sf-feature-inner::before {
          opacity: 1;
        }
        .sf-feature-num {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          margin-bottom: 22px;
          border-radius: 11px;
          background: var(--accent-soft);
          border: 1px solid var(--line);
          color: var(--accent);
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.04em;
          font-feature-settings: "tnum";
          overflow: hidden;
          transition: background 280ms ease;
        }
        .sf-feature-num span { position: relative; z-index: 1; }
        .sf-feature:hover .sf-feature-num {
          background: oklch(48% 0.09 220 / 0.14);
        }
        .sf-feature-title {
          margin: 0 0 10px;
          font-size: 18px;
          font-weight: 600;
          font-variation-settings: "wdth" 92;
          letter-spacing: -0.015em;
          color: var(--ink);
        }
        .sf-feature-body {
          margin: 0;
          color: var(--muted);
          font-size: 14.5px;
          line-height: 1.65;
        }
        .sf-feature-arrow {
          position: absolute;
          right: 20px;
          bottom: 20px;
          color: var(--subtle);
          font-size: 18px;
          opacity: 0;
          transform: translate(-6px, 0);
          transition: opacity 280ms ease, transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1), color 220ms ease;
        }
        .sf-feature:hover .sf-feature-arrow {
          opacity: 1;
          transform: translate(0, 0);
          color: var(--accent);
        }

        /* ── Footer ── */
        .sf-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          margin-top: 120px;
          padding: 32px 4px 8px;
          border-top: 1px solid var(--line);
          color: var(--subtle);
          font-size: 13px;
        }
        .sf-footer-left {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          color: var(--muted);
          font-weight: 500;
        }
        .sf-footer-meta {
          font-family: var(--font-mono);
          font-size: 12px;
          font-feature-settings: "tnum";
        }

        /* ── Reduced motion ── */
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }

        /* ── Responsive ── */
        @media (max-width: 960px) {
          .sf-shell { padding: 64px 18px 32px; }
          .sf-hero, .sf-section {
            grid-template-columns: 1fr;
            gap: 40px;
          }
          .sf-section { margin-top: 64px; }
          .sf-anchor { margin-top: 96px; padding-top: 40px; }
          .sf-pipe-steps {
            grid-template-columns: 1fr 1fr;
            gap: 28px 16px;
          }
          .sf-pipe-rail { display: none; }
          .sf-hero-media {
            min-height: 360px;
            aspect-ratio: 16 / 11;
          }
          .sf-features { grid-template-columns: 1fr; }
          .sf-nav-links, .sf-nav-status { display: none; }
          .sf-meta-row { flex-wrap: wrap; gap: 16px; }
          .sf-meta-divider { display: none; }
        }
        @media (max-width: 560px) {
          .sf-nav { padding: 8px 8px 8px 14px; gap: 12px; }
          .sf-nav-cta { padding: 7px 12px; font-size: 12px; }
          .sf-h1 { font-size: clamp(40px, 12vw, 64px); }
        }
      ` }} />
    </main>
  );
}
