import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Rocket,
} from "lucide-react";
import type { Build, BuildTarget } from "../api/types";

type BuildStatusNoticeProps = {
  build: Build | null;
  error: unknown;
  isQueued: boolean;
  target: BuildTarget | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function BuildStatusNotice({
  build,
  error,
  isQueued,
  target,
}: BuildStatusNoticeProps) {
  if (error) {
    return (
      <div className="surface flex items-start gap-3 border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">Build request failed</p>
          <p className="text-red-200/75">{getErrorMessage(error)}</p>
        </div>
      </div>
    );
  }

  if (isQueued && !build) {
    return (
      <div className="surface flex items-start gap-3 border-cyan-500/25 bg-cyan-500/10 p-4 text-sm text-cyan-100">
        <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
        <div className="space-y-1">
          <p className="font-medium">Sending {target ?? "build"} request</p>
          <p className="text-cyan-100/70">The builder is being queued now.</p>
        </div>
      </div>
    );
  }

  if (!build) {
    return null;
  }

  const isRunning = build.status === "pending" || build.status === "building";
  const isSuccess = build.status === "success";
  const Icon = isRunning ? LoaderCircle : isSuccess ? CheckCircle2 : AlertCircle;
  const tone = isRunning
    ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-100"
    : isSuccess
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
      : "border-red-500/25 bg-red-500/10 text-red-200";

  return (
    <div className={`surface flex items-start gap-3 p-4 text-sm ${tone}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${isRunning ? "animate-spin" : ""}`} />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">
          {build.target} build {build.status}
        </p>
        {isRunning && (
          <p className="text-cyan-100/70">
            Build started {formatDate(build.startedAt)}. This panel refreshes until it finishes.
          </p>
        )}
        {isSuccess && build.outputPath && (
          <p className="truncate font-mono text-xs text-emerald-100/75">
            {build.outputPath}
          </p>
        )}
        {build.status === "failed" && (
          <p className="whitespace-pre-wrap text-red-200/75">
            {build.errorLog ?? "No error log returned."}
          </p>
        )}
      </div>
      {isRunning && <Rocket className="ml-auto h-4 w-4 shrink-0 text-cyan-200/70" />}
    </div>
  );
}
