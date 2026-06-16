import { RichText, type LayoutProps } from "@agenticms/components";

export const keys = {
  "_meta.title": { type: "text", initial: "Live Rendering Demo" },
  "_meta.description": {
    type: "text",
    initial: "A small unpublished AgentiCMS layout for testing runtime preview compilation.",
  },
  "hero.kicker": { type: "text", initial: "Runtime preview" },
  "hero.title": { type: "text", initial: "This layout was added without a rebuild" },
  "hero.body": {
    type: "richtext",
    initial:
      "<p>If this page appears in the admin preview, the layout watcher, module compiler, and browser blob import path are working together.</p>",
  },
  "status.one": { type: "text", initial: "File synced" },
  "status.two": { type: "text", initial: "Watcher registered" },
  "status.three": { type: "text", initial: "Preview compiled" },
};

function value(content: Record<string, string>, key: keyof typeof keys): string {
  return content[key] || keys[key].initial;
}

export default function AgentiCmsLiveDemo({ content }: LayoutProps) {
  const checks = [
    value(content, "status.one"),
    value(content, "status.two"),
    value(content, "status.three"),
  ];

  return (
    <main className="sld-page">
      <style dangerouslySetInnerHTML={{ __html: `
        .sld-page {
          min-height: 100svh;
          display: grid;
          place-items: center;
          padding: 48px 20px;
          color: #15211b;
          background:
            linear-gradient(135deg, rgba(246, 241, 232, 0.96), rgba(232, 240, 235, 0.94)),
            radial-gradient(circle at 18% 12%, rgba(19, 113, 83, 0.16), transparent 34%);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .sld-shell {
          width: min(100%, 980px);
          display: grid;
          grid-template-columns: minmax(0, 1.15fr) minmax(260px, 0.85fr);
          gap: 28px;
          align-items: stretch;
        }
        .sld-main,
        .sld-panel {
          border: 1px solid rgba(21, 33, 27, 0.14);
          background: rgba(255, 255, 255, 0.72);
          box-shadow: 0 18px 60px rgba(21, 33, 27, 0.08);
          backdrop-filter: blur(18px);
        }
        .sld-main { padding: clamp(28px, 5vw, 56px); }
        .sld-panel {
          padding: 28px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 28px;
        }
        .sld-kicker {
          margin: 0 0 20px;
          color: #137153;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .sld-title {
          max-width: 11ch;
          margin: 0;
          font-size: clamp(42px, 8vw, 86px);
          line-height: 0.94;
          letter-spacing: 0;
        }
        .sld-body {
          max-width: 58ch;
          margin-top: 28px;
          color: rgba(21, 33, 27, 0.72);
          font-size: 18px;
          line-height: 1.72;
        }
        .sld-body p { margin: 0; }
        .sld-chip {
          width: fit-content;
          padding: 9px 12px;
          border: 1px solid rgba(19, 113, 83, 0.24);
          color: #137153;
          background: rgba(19, 113, 83, 0.08);
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .sld-list {
          display: grid;
          gap: 12px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .sld-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 14px 0;
          border-bottom: 1px solid rgba(21, 33, 27, 0.12);
          font-size: 15px;
          font-weight: 700;
        }
        .sld-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #137153;
          box-shadow: 0 0 0 6px rgba(19, 113, 83, 0.12);
        }
        @media (max-width: 760px) {
          .sld-shell { grid-template-columns: 1fr; }
          .sld-title { max-width: 12ch; }
        }
      ` }} />

      <section className="sld-shell" aria-label="Live rendering demo">
        <div className="sld-main">
          <p className="sld-kicker">{value(content, "hero.kicker")}</p>
          <h1 className="sld-title">{value(content, "hero.title")}</h1>
          <RichText value={value(content, "hero.body")} className="sld-body" />
        </div>

        <aside className="sld-panel">
          <span className="sld-chip">On the fly</span>
          <ul className="sld-list">
            {checks.map((check) => (
              <li className="sld-item" key={check}>
                <span>{check}</span>
                <span className="sld-dot" aria-hidden="true" />
              </li>
            ))}
          </ul>
        </aside>
      </section>
    </main>
  );
}
