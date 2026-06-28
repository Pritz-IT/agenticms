import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { toastError } from "../lib/toast-error";
import { TopBar } from "../components/TopBar";
import { fetchSubmissions, deleteSubmission } from "../api/submissions";
import type { Submission } from "../api/types";
import { DEFAULT_SITE_KEY } from "../site-routing";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

// ── Submission data shape (self-describing, sent by the quiz) ──────────────
interface ScoredCategory {
  label: string;
  score: number;
  max: number;
  pct: number;
}
interface QuizResponse {
  q: string;
  a: string;
  points: number;
  max: number;
}
interface QuizData {
  score?: number;
  max?: number;
  level?: string;
  pct?: number;
  categories?: ScoredCategory[];
  responses?: QuizResponse[];
}

function asQuizData(data: Record<string, unknown>): QuizData {
  return (data ?? {}) as QuizData;
}

function levelColor(level: string | undefined, pct: number | undefined) {
  const l = (level ?? "").toLowerCase();
  if (l === "high" || (pct ?? -1) >= 70) return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  if (l === "mid" || (pct ?? -1) >= 38) return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  return "border-red-500/25 bg-red-500/10 text-red-300";
}

function ScoreBadge({
  score,
  data,
}: {
  score: number | null;
  data: Record<string, unknown>;
}) {
  if (score === null) return null;
  const d = asQuizData(data);
  const max = typeof d.max === "number" ? d.max : null;
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium border ${levelColor(d.level, d.pct)}`}
    >
      {score}
      {max !== null ? `/${max}` : ""}
      {d.level ? ` · ${d.level}` : ""}
    </span>
  );
}

export function SubmissionsPage() {
  const { siteKey = DEFAULT_SITE_KEY } = useParams<{ siteKey: string }>();
  const qc = useQueryClient();
  const [formFilter, setFormFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["submissions", siteKey, formFilter],
    queryFn: () => fetchSubmissions(siteKey, formFilter || undefined),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSubmission(siteKey, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["submissions", siteKey] });
      toast.success("Submission deleted");
    },
    onError: (err) => {
      toastError("Failed to delete", err);
    },
  });

  const submissions = query.data ?? [];
  const forms = [...new Set(submissions.map((s) => s.form))];

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Submissions" subtitle="Form and quiz submissions" />

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-4">
        {forms.length > 1 && (
          <div className="flex gap-2">
            <button
              onClick={() => setFormFilter("")}
              className={`px-3 py-1.5 text-xs font-medium rounded border transition ${
                !formFilter
                  ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                  : "border-neutral-700 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              All
            </button>
            {forms.map((f) => (
              <button
                key={f}
                onClick={() => setFormFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded border transition ${
                  formFilter === f
                    ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                    : "border-neutral-700 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        {query.isLoading ? (
          <p className="text-neutral-500">Loading…</p>
        ) : query.isError ? (
          <p className="text-red-400">Failed to load submissions.</p>
        ) : submissions.length === 0 ? (
          <p className="text-neutral-500">No submissions yet.</p>
        ) : (
          <div className="border border-neutral-700 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-800 text-neutral-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">Form</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Score</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {submissions.map((s) => (
                  <SubmissionRow
                    key={s.id}
                    submission={s}
                    expanded={expanded === s.id}
                    onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                    onDelete={() => deleteMutation.mutate(s.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SubmissionRow({
  submission: s,
  expanded,
  onToggle,
  onDelete,
}: {
  submission: Submission;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <tr
        className="hover:bg-neutral-800/50 cursor-pointer transition"
        onClick={onToggle}
      >
        <td className="px-4 py-3 font-medium text-neutral-200">{s.form}</td>
        <td className="px-4 py-3 text-neutral-400">
          {s.email || "—"}
          {s.wantsContact && (
            <span className="ml-2 inline-block rounded px-2 py-0.5 text-xs font-medium border border-cyan-500/40 bg-cyan-500/10 text-cyan-300">
              Kontakt gewünscht
            </span>
          )}
        </td>
        <td className="px-4 py-3"><ScoreBadge score={s.score} data={s.data} /></td>
        <td className="px-4 py-3 text-neutral-500">{formatDate(s.createdAt)}</td>
        <td className="px-4 py-3 text-right">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-xs text-red-400 hover:text-red-300 transition"
          >
            Delete
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="px-4 py-4 bg-neutral-900/50">
            <SubmissionDetail data={s.data} email={s.email} />
          </td>
        </tr>
      )}
    </>
  );
}

// Pretty-print an object key as a human label: "company" → "Company",
// "wantsContact" → "Wants Contact", "data_source" → "Data Source".
function prettifyKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// Clean key-value view for any flat form payload (contact, working-capital,
// solutions-consultation, …). Generic over the keys so new forms render too.
function FlatDataView({
  data,
  email,
}: {
  data: Record<string, unknown>;
  email: string | null;
}) {
  const entries = Object.entries(data ?? {});
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {email && (
        <div className="flex gap-4">
          <dt className="w-40 shrink-0 text-neutral-500">Email</dt>
          <dd className="flex-1 text-neutral-200 break-words">{email}</dd>
        </div>
      )}
      {entries.length === 0 && !email ? (
        <p className="text-neutral-500">No data.</p>
      ) : (
        entries.map(([key, value]) => (
          <div key={key} className="flex gap-4">
            <dt className="w-40 shrink-0 text-neutral-500">{prettifyKey(key)}</dt>
            <dd className="flex-1 text-neutral-200 whitespace-pre-wrap break-words">
              {formatValue(value)}
            </dd>
          </div>
        ))
      )}
    </dl>
  );
}

function SubmissionDetail({
  data,
  email,
}: {
  data: Record<string, unknown>;
  email: string | null;
}) {
  const d = asQuizData(data);
  const hasTranscript = Array.isArray(d.responses) && d.responses.length > 0;

  if (!hasTranscript) {
    // Flat forms (contact, working-capital, solutions-consultation, …) get a
    // clean key-value view. Only the quiz (responses[] present) gets the rich
    // scorecard/transcript layout below.
    return <FlatDataView data={data} email={email} />;
  }

  return (
    <div className="flex flex-col gap-5 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-neutral-300">
        {email && (
          <span>
            <span className="text-neutral-500">Email: </span>
            {email}
          </span>
        )}
        <span>
          <span className="text-neutral-500">Score: </span>
          {d.score ?? "—"}
          {typeof d.max === "number" ? ` / ${d.max}` : ""}
        </span>
        {typeof d.pct === "number" && (
          <span>
            <span className="text-neutral-500">Datenhoheit: </span>
            {d.pct}%
          </span>
        )}
        {d.level && (
          <span
            className={`inline-block rounded px-2 py-0.5 text-xs font-medium border ${levelColor(d.level, d.pct)}`}
          >
            {d.level}
          </span>
        )}
      </div>

      {Array.isArray(d.categories) && d.categories.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs uppercase tracking-wider text-neutral-500">Scorecard</div>
          {d.categories.map((c, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-56 shrink-0 text-neutral-300">{c.label}</span>
              <div className="flex-1 h-1.5 rounded bg-neutral-800 overflow-hidden">
                <div
                  className="h-full bg-cyan-500/60"
                  style={{ width: `${Math.max(0, Math.min(100, c.pct))}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-neutral-400">
                {c.score}/{c.max}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="text-xs uppercase tracking-wider text-neutral-500">Answers</div>
        <ol className="flex flex-col gap-3">
          {d.responses!.map((r, i) => (
            <li key={i} className="border-l-2 border-neutral-700 pl-3">
              <div className="text-neutral-300">
                {i + 1}. {r.q}
              </div>
              <div className="mt-0.5 text-neutral-400">
                → {r.a || "—"}
                <span className="ml-2 text-xs text-neutral-600">
                  ({r.points}/{r.max})
                </span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
