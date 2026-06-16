import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "../lib/toast-error";
import { Save } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { fetchLocales } from "../api/locales";
import { fetchSettings, updateSettings } from "../api/settings";
import { DEFAULT_SITE_KEY } from "../site-routing";

export function SettingsPage() {
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  const qc = useQueryClient();

  const settingsQuery = useQuery({ queryKey: ["settings", siteKey], queryFn: () => fetchSettings(siteKey) });
  const localesQuery = useQuery({ queryKey: ["locales", siteKey], queryFn: () => fetchLocales(siteKey) });

  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [stagingDomain, setStagingDomain] = useState("");
  const [defaultLocale, setDefaultLocale] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const locales = localesQuery.data ?? [];

  useEffect(() => {
    if (settingsQuery.data) {
      setName(settingsQuery.data.name);
      setDomain(settingsQuery.data.domain);
      setStagingDomain(settingsQuery.data.stagingDomain);
      setDefaultLocale(settingsQuery.data.defaultLocale);
      setSiteUrl(settingsQuery.data.siteUrl ?? "");
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (data: Parameters<typeof updateSettings>[1]) => updateSettings(siteKey, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", siteKey] });
      toast.success("Settings saved");
    },
    onError: (err) => {
      toastError("Failed to save settings", err);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    saveMutation.mutate({ name, domain, stagingDomain, defaultLocale, siteUrl });
  }

  return (
    <div className="app-page">
      <TopBar title="Settings" subtitle="Configure your site" />

      <div className="app-content">
        {settingsQuery.isLoading ? (
          <div className="surface max-w-2xl space-y-4 p-5">
            <div className="skeleton-line w-1/3" />
            <div className="skeleton-line w-full" />
            <div className="skeleton-line w-4/5" />
          </div>
        ) : settingsQuery.isError ? (
          <div className="surface p-4 text-sm text-red-300">Failed to load settings.</div>
        ) : (
          <form onSubmit={handleSubmit} className="surface flex max-w-2xl flex-col gap-5 p-5">
            <div className="flex flex-col gap-1.5">
              <label className="ui-label">Site Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="ui-label">Domain</label>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="https://example.com"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="ui-label">Site URL</label>
              <input
                type="text"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://www.example.com"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="ui-label">Staging Domain</label>
              <input
                type="text"
                value={stagingDomain}
                onChange={(e) => setStagingDomain(e.target.value)}
                placeholder="https://staging.example.com"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="ui-label">Default Locale</label>
              {localesQuery.isLoading ? (
                <select value={defaultLocale} disabled>
                  <option>{defaultLocale || "Loading locales..."}</option>
                </select>
              ) : locales.length > 0 ? (
                <select
                  value={defaultLocale}
                  onChange={(e) => setDefaultLocale(e.target.value)}
                  required
                >
                  {locales.map((locale) => (
                    <option key={locale.id} value={locale.code}>
                      {locale.code.toUpperCase()} - {locale.label}
                    </option>
                  ))}
                </select>
              ) : (
                <select value="" disabled>
                  <option>No locales configured</option>
                </select>
              )}
              {localesQuery.isError && (
                <p className="text-xs text-red-300">Failed to load locales for this site.</p>
              )}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="ui-button ui-button-primary"
              >
                <Save className="h-4 w-4" />
                {saveMutation.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
