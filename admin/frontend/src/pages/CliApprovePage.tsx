import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, KeyRound } from "lucide-react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { TopBar } from "../components/TopBar";
import { toastError } from "../lib/toast-error";

async function approveCliDevice(deviceId: string, code: string): Promise<{ ok: true }> {
  return api(`/api/cli/device/${deviceId}/approve`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function formatOtp(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function initialApprovalCodeFromUrl(_searchParams: URLSearchParams): string {
  return "";
}

export function CliApprovePage() {
  const { deviceId = "" } = useParams();
  const [code, setCode] = useState(() => initialApprovalCodeFromUrl(new URLSearchParams()));
  const [approved, setApproved] = useState(false);

  const approveMutation = useMutation({
    mutationFn: () => approveCliDevice(deviceId, code),
    onSuccess: () => setApproved(true),
    onError: (err) => toastError("CLI approval failed", err),
  });

  const canSubmit = deviceId && code.length === 6 && !approveMutation.isPending && !approved;

  return (
    <div className="app-page">
      <TopBar title="CLI Approval" subtitle="Authorize a local AgentiCMS CLI session" />

      <div className="app-content">
        <div className="surface mx-auto max-w-xl p-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-cyan-500/20 bg-cyan-500/10 text-cyan-300">
              {approved ? <CheckCircle2 className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100">
                {approved ? "CLI session approved" : "Approve CLI session"}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                {approved ? "You can return to the terminal." : "Enter the six-digit code shown by the CLI."}
              </p>
            </div>
          </div>

          <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
            Approval code
          </label>
          <input
            value={code}
            onChange={(event) => setCode(formatOtp(event.target.value))}
            inputMode="numeric"
            autoComplete="one-time-code"
            className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-lg tracking-[0.3em] text-zinc-100 outline-none transition focus:border-cyan-500/60"
            placeholder="000000"
            disabled={approved}
          />

          <button
            type="button"
            className="ui-button ui-button-primary mt-5 w-full justify-center"
            disabled={!canSubmit}
            onClick={() => approveMutation.mutate()}
          >
            <KeyRound className="h-4 w-4" />
            {approveMutation.isPending ? "Approving..." : approved ? "Approved" : "Approve CLI"}
          </button>
        </div>
      </div>
    </div>
  );
}
