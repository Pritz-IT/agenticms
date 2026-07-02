import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "../lib/toast-error";
import { Plus, Save, X } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { fetchLocales } from "../api/locales";
import { fetchSettings, updateSettings } from "../api/settings";
import { fetchForms, addForm, removeForm } from "../api/forms";
import { DEFAULT_SITE_KEY } from "../site-routing";

const FORM_SLUG_PATTERN = /^[a-z0-9-]+$/;

export function SettingsPage() {
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  const qc = useQueryClient();

  const settingsQuery = useQuery({ queryKey: ["settings", siteKey], queryFn: () => fetchSettings(siteKey) });
  const localesQuery = useQuery({ queryKey: ["locales", siteKey], queryFn: () => fetchLocales(siteKey) });
  const formsQuery = useQuery({ queryKey: ["forms", siteKey], queryFn: () => fetchForms(siteKey) });

  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [stagingDomain, setStagingDomain] = useState("");
  const [defaultLocale, setDefaultLocale] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [newForm, setNewForm] = useState("");
  const locales = localesQuery.data ?? [];
  const forms = formsQuery.data?.forms ?? [];

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

  const addFormMutation = useMutation({
    mutationFn: (form: string) => addForm(siteKey, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forms", siteKey] });
      setNewForm("");
      toast.success("Form added");
    },
    onError: (err) => {
      toastError("Failed to add form", err);
    },
  });

  const removeFormMutation = useMutation({
    mutationFn: (slug: string) => removeForm(siteKey, slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forms", siteKey] });
      toast.success("Form removed");
    },
    onError: (err) => {
      toastError("Failed to remove form", err);
    },
  });

  function handleAddForm(e: React.FormEvent) {
    e.preventDefault();
    const slug = newForm.trim();
    if (!FORM_SLUG_PATTERN.test(slug)) {
      toast.error("Use lowercase letters, numbers, and hyphens only");
      return;
    }
    addFormMutation.mutate(slug.toLowerCase());
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

        <div className="surface mt-6 flex max-w-2xl flex-col gap-4 p-5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Submission Forms</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Form names this site's public submissions endpoint will accept.
            </p>
          </div>

          {formsQuery.isLoading ? (
            <div className="space-y-2">
              <div className="skeleton-line w-1/3" />
              <div className="skeleton-line w-1/4" />
            </div>
          ) : formsQuery.isError ? (
            <p className="text-sm text-red-300">Failed to load submission forms.</p>
          ) : (
            <>
              {forms.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  This site accepts no submission forms yet. Add a form name (e.g. <code>contact</code>) to start
                  accepting submissions.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {forms.map((slug) => (
                    <span
                      key={slug}
                      className="status-pill gap-1.5 border-zinc-700 bg-zinc-800/60 text-zinc-200"
                    >
                      {slug}
                      <button
                        type="button"
                        onClick={() => removeFormMutation.mutate(slug)}
                        disabled={removeFormMutation.isPending}
                        aria-label={`Remove ${slug}`}
                        className="text-zinc-500 transition hover:text-red-300 disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <form onSubmit={handleAddForm} className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <label className="ui-label">Add Form</label>
                  <input
                    type="text"
                    value={newForm}
                    onChange={(e) => setNewForm(e.target.value)}
                    placeholder="contact"
                  />
                </div>
                <button
                  type="submit"
                  disabled={addFormMutation.isPending || !newForm.trim()}
                  className="ui-button ui-button-primary"
                >
                  <Plus className="h-4 w-4" />
                  {addFormMutation.isPending ? "Adding…" : "Add"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
