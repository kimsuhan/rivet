import { Skeleton } from '@/components/ui/skeleton';

export function ContentLoading({ label }: { label: string }) {
  return (
    <section aria-busy="true" aria-label={label} className="py-6">
      <span role="status" className="sr-only">
        {label}
      </span>
      <div aria-hidden="true" className="border-t">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={`loading-row-${index}`}
            className="flex min-h-14 items-center gap-3 border-b py-3"
          >
            <Skeleton className="size-5 shrink-0 motion-reduce:animate-none" />
            <Skeleton className="h-3.5 w-24 motion-reduce:animate-none" />
            <Skeleton className="h-3.5 max-w-80 flex-1 motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </section>
  );
}
