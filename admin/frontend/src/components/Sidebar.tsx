import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  FileText,
  FolderKanban,
  Globe2,
  Image,
  LayoutTemplate,
  Menu,
  LogOut,
  Settings,
  ShieldCheck,
  Terminal,
  type LucideIcon,
  Users,
} from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { fetchSites } from "../api/sites";
import { DEFAULT_SITE_KEY, replaceSiteKeyInPath, siteSectionPath } from "../site-routing";

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

function contentItems(siteKey: string): NavItem[] {
  return [
    { to: siteSectionPath(siteKey, "pages"), icon: FileText, label: "Pages" },
    { to: siteSectionPath(siteKey, "navigation"), icon: Menu, label: "Navigation" },
    { to: siteSectionPath(siteKey, "assets"), icon: Image, label: "Assets" },
    { to: siteSectionPath(siteKey, "submissions"), icon: ClipboardList, label: "Submissions" },
  ];
}

function buildItems(siteKey: string): NavItem[] {
  return [
    { to: siteSectionPath(siteKey, "builds"), icon: FolderKanban, label: "Builds" },
    { to: siteSectionPath(siteKey, "layouts"), icon: LayoutTemplate, label: "Layouts" },
  ];
}

function adminItems(siteKey: string): NavItem[] {
  return [
    { to: siteSectionPath(siteKey, "settings"), icon: Settings, label: "Settings" },
    { to: siteSectionPath(siteKey, "locales"), icon: Globe2, label: "Languages" },
    { to: siteSectionPath(siteKey, "staging-access"), icon: ShieldCheck, label: "Staging" },
    { to: siteSectionPath(siteKey, "cli"), icon: Terminal, label: "CLI" },
    { to: "/users", icon: Users, label: "Users" },
  ];
}

const STORAGE_KEY = "admin.sidebar.collapsed";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === null ? true : raw === "1";
}

function isNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

interface SidebarLinkProps extends NavItem {
  collapsed: boolean;
}

function SidebarLink({ to, icon: Icon, label, collapsed }: SidebarLinkProps) {
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `group relative flex h-10 items-center rounded-md transition duration-200 ${
          collapsed ? "w-10 justify-center" : "w-full gap-3 px-3"
        } ${
          isActive
            ? "bg-cyan-400 text-zinc-950 shadow-[0_10px_30px_-16px_rgba(34,211,238,0.9)]"
            : "text-zinc-500 hover:-translate-y-0.5 hover:bg-zinc-900 hover:text-zinc-100"
        }`
      }
    >
      <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={1.8} />
      {!collapsed && (
        <span className="truncate text-sm font-medium">{label}</span>
      )}
      {collapsed && (
        <span className="pointer-events-none absolute left-12 top-1/2 z-20 -translate-y-1/2 whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs font-medium text-zinc-200 opacity-0 shadow-xl transition group-hover:translate-x-1 group-hover:opacity-100">
          {label}
        </span>
      )}
    </NavLink>
  );
}

interface SectionProps {
  section: NavSection;
  collapsed: boolean;
}

function Section({ section, collapsed }: SectionProps) {
  return (
    <nav className="flex w-full flex-col gap-1" aria-label={section.label}>
      {!collapsed && (
        <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
          {section.label}
        </div>
      )}
      {section.items.map((item) => (
        <SidebarLink key={item.to} {...item} collapsed={collapsed} />
      ))}
    </nav>
  );
}

export function Sidebar() {
  const { user, logout } = useAuth();
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [narrowViewport, setNarrowViewport] = useState<boolean>(isNarrowViewport);
  const sitesQuery = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const effectiveCollapsed = collapsed || narrowViewport;

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setNarrowViewport(query.matches);

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const sections: NavSection[] = [
    { id: "content", label: "Content", items: contentItems(siteKey) },
    { id: "build", label: "Build", items: buildItems(siteKey) },
  ];
  if (user?.role === "admin") {
    sections.push({ id: "admin", label: "Administration", items: adminItems(siteKey) });
  }

  const sites = sitesQuery.data ?? [];

  function handleSiteChange(nextKey: string) {
    if (!nextKey || nextKey === siteKey) return;
    navigate(replaceSiteKeyInPath(location.pathname, siteKey, nextKey));
  }

  return (
    <aside
      className={`flex shrink-0 flex-col gap-2 border-r border-zinc-800/90 bg-zinc-950/82 py-4 shadow-[inset_-1px_0_0_rgba(255,255,255,0.02)] backdrop-blur transition-[width] duration-200 ${
        effectiveCollapsed ? "w-16 items-center px-3" : "w-56 items-stretch px-3"
      }`}
    >
      {/* The brand chip is always a fixed 10x10 in the same x position. The
          wordmark slides in as a sibling when expanded, so the chip itself
          doesn't reflow during the width transition. */}
      <div className="mb-3 flex h-10 w-full items-center gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-[radial-gradient(circle_at_35%_25%,rgba(255,255,255,0.22),transparent_34%),linear-gradient(135deg,rgba(34,211,238,0.24),rgba(14,116,144,0.12))] text-[11px] font-semibold tracking-[0.16em] text-cyan-100 shadow-[0_0_28px_-16px_rgba(34,211,238,0.9)]">
          AI
        </div>
        {!effectiveCollapsed && (
          <span className="truncate text-[10px] font-medium tracking-[0.12em] text-cyan-200/60">
            AGENTICMS
          </span>
        )}
      </div>

      {sites.length > 0 && (
        <div className={effectiveCollapsed ? "mb-3 w-10" : "mb-3 w-full"}>
          <label className="sr-only" htmlFor="site-switcher">Site</label>
          <select
            id="site-switcher"
            value={siteKey}
            onChange={(event) => handleSiteChange(event.target.value)}
            title="Switch site"
            className={`h-9 rounded-md border border-zinc-800 bg-zinc-950 text-xs text-zinc-200 outline-none transition hover:border-zinc-700 focus:border-cyan-500 ${
              effectiveCollapsed ? "w-10 px-1" : "w-full px-2"
            }`}
          >
            {sites.map((site) => (
              <option key={site.id} value={site.key}>
                {effectiveCollapsed ? site.key : site.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {sections.map((section, idx) => (
        <div key={section.id} className="contents">
          {idx > 0 && effectiveCollapsed && <div className="my-2 h-px w-8 bg-zinc-800" />}
          <Section section={section} collapsed={effectiveCollapsed} />
        </div>
      ))}

      <div className="mt-auto flex w-full flex-col gap-1">
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={effectiveCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={effectiveCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!effectiveCollapsed}
          className={`group hidden h-10 items-center rounded-md text-zinc-500 transition duration-200 hover:bg-zinc-900 hover:text-zinc-100 md:flex ${
            effectiveCollapsed ? "w-10 justify-center" : "w-full gap-3 px-3"
          }`}
        >
          {effectiveCollapsed ? (
            <ChevronsRight className="h-4.5 w-4.5" strokeWidth={1.8} />
          ) : (
            <ChevronsLeft className="h-4.5 w-4.5 shrink-0" strokeWidth={1.8} />
          )}
          {!effectiveCollapsed && <span className="truncate text-sm">Collapse</span>}
        </button>

        <button
          onClick={logout}
          title={effectiveCollapsed ? "Logout" : undefined}
          className={`group relative flex h-10 items-center rounded-md text-zinc-500 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-900 hover:text-zinc-100 active:translate-y-0 ${
            effectiveCollapsed ? "w-10 justify-center" : "w-full gap-3 px-3"
          }`}
        >
          <LogOut className="h-4.5 w-4.5 shrink-0" strokeWidth={1.8} />
          {!effectiveCollapsed && <span className="truncate text-sm">Logout</span>}
        </button>
      </div>
    </aside>
  );
}
