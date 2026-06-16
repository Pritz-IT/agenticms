import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TopBar } from "../components/TopBar";
import {
  createStagingAccess,
  deleteStagingAccess,
  fetchStagingAccess,
} from "../api/staging-access";
import { DEFAULT_SITE_KEY } from "../site-routing";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function StagingAccessPage() {
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  const qc = useQueryClient();
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const accessQuery = useQuery({ queryKey: ["staging-access", siteKey], queryFn: () => fetchStagingAccess(siteKey) });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createStagingAccess>[1]) => createStagingAccess(siteKey, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staging-access", siteKey] });
      setNewUsername("");
      setNewPassword("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStagingAccess(siteKey, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staging-access", siteKey] }),
  });

  const entries = accessQuery.data ?? [];

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createMutation.mutate({ username: newUsername.trim(), password: newPassword } as any);
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Staging Access" subtitle="Manage staging credentials" />

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
        {accessQuery.isLoading ? (
          <p className="text-neutral-500">Loading…</p>
        ) : accessQuery.isError ? (
          <p className="text-red-400">Failed to load staging access.</p>
        ) : (
          <div className="border border-neutral-700 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-800 text-neutral-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">Username</th>
                  <th className="text-left px-4 py-3">Expires</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-neutral-500">
                      No staging credentials configured.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-neutral-800/50 transition-colors">
                      <td className="px-4 py-3 text-white font-mono">{entry.username}</td>
                      <td className="px-4 py-3 text-neutral-400 text-xs">
                        {formatDate(entry.expiresAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            if (confirm(`Delete access for "${entry.username}"?`)) {
                              deleteMutation.mutate(entry.id);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <form
          onSubmit={handleAdd}
          className="bg-neutral-800 border border-neutral-700 rounded p-4 flex items-end gap-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-400 uppercase tracking-wider">Username</label>
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="staging-user"
              className="bg-neutral-900 border border-neutral-600 text-white rounded px-3 py-1.5 text-sm w-40 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-400 uppercase tracking-wider">Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="bg-neutral-900 border border-neutral-600 text-white rounded px-3 py-1.5 text-sm w-40 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending || !newUsername.trim() || !newPassword.trim()}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded"
          >
            {createMutation.isPending ? "Adding…" : "Add"}
          </button>
        </form>
      </div>
    </div>
  );
}
