import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TopBar } from "../components/TopBar";
import { createLocale, deleteLocale, fetchLocales, updateLocale } from "../api/locales";
import { DEFAULT_SITE_KEY } from "../site-routing";

interface LocaleDraft {
  code: string;
  label: string;
  sortOrder: string;
}

export function LocalesPage() {
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  const qc = useQueryClient();
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LocaleDraft>({ code: "", label: "", sortOrder: "0" });

  const localesQuery = useQuery({ queryKey: ["locales", siteKey], queryFn: () => fetchLocales(siteKey) });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createLocale>[1]) => createLocale(siteKey, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["locales", siteKey] });
      setNewCode("");
      setNewLabel("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateLocale>[2] }) =>
      updateLocale(siteKey, id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["locales", siteKey] });
      qc.invalidateQueries({ queryKey: ["settings", siteKey] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLocale(siteKey, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locales", siteKey] }),
  });

  const locales = localesQuery.data ?? [];

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newLabel.trim()) return;
    createMutation.mutate({ code: newCode.trim().toLowerCase(), label: newLabel.trim() });
  }

  function startEdit(locale: (typeof locales)[number]) {
    setEditingId(locale.id);
    setDraft({
      code: locale.code,
      label: locale.label,
      sortOrder: String(locale.sortOrder),
    });
  }

  function saveEdit(id: string) {
    const code = draft.code.trim().toLowerCase();
    const label = draft.label.trim();
    const sortOrder = Number.parseInt(draft.sortOrder, 10);
    if (!code || !label || Number.isNaN(sortOrder)) return;
    updateMutation.mutate({ id, data: { code, label, sortOrder } });
  }

  function makeDefault(id: string) {
    updateMutation.mutate({ id, data: { isDefault: true } });
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Languages" subtitle="Manage locales" />

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
        {localesQuery.isLoading ? (
          <p className="text-neutral-500">Loading…</p>
        ) : localesQuery.isError ? (
          <p className="text-red-400">Failed to load locales.</p>
        ) : (
          <div className="border border-neutral-700 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-800 text-neutral-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">Code</th>
                  <th className="text-left px-4 py-3">Label</th>
                  <th className="text-left px-4 py-3">Order</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {locales.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                      No locales configured.
                    </td>
                  </tr>
                ) : (
                  locales.map((locale) => {
                    const isEditing = editingId === locale.id;
                    return (
                      <tr key={locale.id} className="hover:bg-neutral-800/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {isEditing ? (
                              <input
                                type="text"
                                value={draft.code}
                                onChange={(e) => setDraft((current) => ({ ...current, code: e.target.value }))}
                                className="bg-neutral-900 border border-neutral-600 text-white rounded px-2 py-1 text-sm w-20 focus:outline-none focus:border-blue-500"
                              />
                            ) : (
                              <span className="font-bold text-white">{locale.code.toUpperCase()}</span>
                            )}
                            {locale.isDefault && (
                              <span className="px-1.5 py-0.5 rounded text-xs bg-blue-900 text-blue-300 border border-blue-700">
                                default
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-neutral-300">
                          {isEditing ? (
                            <input
                              type="text"
                              value={draft.label}
                              onChange={(e) => setDraft((current) => ({ ...current, label: e.target.value }))}
                              className="bg-neutral-900 border border-neutral-600 text-white rounded px-2 py-1 text-sm w-44 focus:outline-none focus:border-blue-500"
                            />
                          ) : (
                            locale.label
                          )}
                        </td>
                        <td className="px-4 py-3 text-neutral-300">
                          {isEditing ? (
                            <input
                              type="number"
                              value={draft.sortOrder}
                              onChange={(e) => setDraft((current) => ({ ...current, sortOrder: e.target.value }))}
                              className="bg-neutral-900 border border-neutral-600 text-white rounded px-2 py-1 text-sm w-20 focus:outline-none focus:border-blue-500"
                            />
                          ) : (
                            locale.sortOrder
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-3">
                            {isEditing ? (
                              <>
                                <button
                                  onClick={() => saveEdit(locale.id)}
                                  disabled={
                                    updateMutation.isPending ||
                                    !draft.code.trim() ||
                                    !draft.label.trim() ||
                                    Number.isNaN(Number.parseInt(draft.sortOrder, 10))
                                  }
                                  className="text-xs text-blue-300 hover:text-blue-200 disabled:opacity-40"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  disabled={updateMutation.isPending}
                                  className="text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-40"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                {!locale.isDefault && (
                                  <button
                                    onClick={() => makeDefault(locale.id)}
                                    disabled={updateMutation.isPending}
                                    className="text-xs text-blue-300 hover:text-blue-200 disabled:opacity-40"
                                  >
                                    Make default
                                  </button>
                                )}
                                <button
                                  onClick={() => startEdit(locale)}
                                  disabled={updateMutation.isPending}
                                  className="text-xs text-neutral-300 hover:text-white disabled:opacity-40"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => {
                                    if (confirm(`Delete locale "${locale.code}"?`)) {
                                      deleteMutation.mutate(locale.id);
                                    }
                                  }}
                                  disabled={deleteMutation.isPending || locale.isDefault}
                                  className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            {updateMutation.isError && (
              <p className="border-t border-neutral-800 px-4 py-3 text-xs text-red-400">
                Failed to update locale.
              </p>
            )}
            {deleteMutation.isError && (
              <p className="border-t border-neutral-800 px-4 py-3 text-xs text-red-400">
                Failed to delete locale.
              </p>
            )}
          </div>
        )}

        <form
          onSubmit={handleAdd}
          className="bg-neutral-800 border border-neutral-700 rounded p-4 flex items-end gap-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-400 uppercase tracking-wider">Code</label>
            <input
              type="text"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="en"
              className="bg-neutral-900 border border-neutral-600 text-white rounded px-3 py-1.5 text-sm w-20 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-400 uppercase tracking-wider">Label</label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="English"
              className="bg-neutral-900 border border-neutral-600 text-white rounded px-3 py-1.5 text-sm w-40 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending || !newCode.trim() || !newLabel.trim()}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded"
          >
            {createMutation.isPending ? "Adding…" : "Add"}
          </button>
          {createMutation.isError && <p className="text-xs text-red-400">Failed to add locale.</p>}
        </form>
      </div>
    </div>
  );
}
