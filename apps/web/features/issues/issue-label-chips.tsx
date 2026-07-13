import type { IssueLabelSummaryResponseDto } from '@rivet/api-client';

import { Badge } from '@/components/ui/badge';

export function IssueLabelChips({
  emptyLabel,
  labels,
  limit = 2,
  showEmpty = false,
}: {
  emptyLabel: string;
  labels: IssueLabelSummaryResponseDto[];
  limit?: number;
  showEmpty?: boolean;
}) {
  if (labels.length === 0) {
    return showEmpty ? <span className="text-muted-foreground text-sm">{emptyLabel}</span> : null;
  }

  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {labels.slice(0, limit).map((label) => (
        <Badge
          key={label.id}
          variant="outline"
          className="max-w-28 truncate px-1.5"
          title={label.name}
        >
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: label.color }}
          />
          {label.name}
        </Badge>
      ))}
      {labels.length > limit ? (
        <span className="text-muted-foreground shrink-0 text-xs">+{labels.length - limit}</span>
      ) : null}
    </span>
  );
}
