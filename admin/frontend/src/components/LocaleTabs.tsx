import { useQuery } from "@tanstack/react-query";
import { fetchLocales } from "../api/locales";

interface CompletionEntry {
  filled: number;
  total: number;
}

interface LocaleTabsProps {
  siteKey: string;
  selectedLocale: string;
  onSelectLocale: (locale: string) => void;
  completionMap?: Record<string, CompletionEntry>;
}

function CompletionBadge({ filled, total }: CompletionEntry) {
  const isEmpty = filled === 0;
  const isComplete = filled === total && total > 0;

  const colorClass = isComplete
    ? "text-green-400 border-green-700"
    : isEmpty
      ? "text-red-400 border-red-800"
      : "text-yellow-400 border-yellow-800";

  return (
    <span className={`text-[10px] border rounded px-1 py-0.5 ${colorClass}`}>
      {filled}/{total}
    </span>
  );
}

export function LocaleTabs({ siteKey, selectedLocale, onSelectLocale, completionMap }: LocaleTabsProps) {
  const { data: locales = [], isLoading } = useQuery({
    queryKey: ["locales", siteKey],
    queryFn: () => fetchLocales(siteKey),
  });

  if (isLoading) {
    return <div className="h-10 bg-neutral-800 rounded animate-pulse" />;
  }

  return (
    <div className="flex items-center gap-1 border-b border-neutral-700 px-1">
      {locales.map((locale) => {
        const isSelected = locale.code === selectedLocale;
        const completion = completionMap?.[locale.code];

        return (
          <button
            key={locale.id}
            type="button"
            onClick={() => onSelectLocale(locale.code)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors ${
              isSelected
                ? "border-blue-500 text-white"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <span>{locale.code.toUpperCase()}</span>
            {completion !== undefined && (
              <CompletionBadge filled={completion.filled} total={completion.total} />
            )}
          </button>
        );
      })}
    </div>
  );
}
