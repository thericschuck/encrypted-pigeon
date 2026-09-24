import { Skeleton } from "@/components/ui/skeleton";

/** Dashboard placeholder while the chat overview loads on the server. */
export default function DashboardLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Wird geladen"
      className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col gap-6 px-4 pt-[max(1.5rem,env(safe-area-inset-top))]"
    >
      <div className="flex items-center gap-3 px-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 px-3 py-2">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
