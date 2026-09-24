import { Skeleton } from "@/components/ui/skeleton";

// Alternating bubble widths so the placeholder reads as a conversation.
const PLACEHOLDER_BUBBLES: { own: boolean; width: string; tall?: boolean }[] = [
  { own: false, width: "w-40" },
  { own: true, width: "w-52" },
  { own: false, width: "w-56", tall: true },
  { own: true, width: "w-32" },
  { own: false, width: "w-44" },
  { own: true, width: "w-60", tall: true },
];

/** Shown while page.tsx loads participants + chat history on the server. */
export default function ChatLoading() {
  return (
    <main className="flex h-[100dvh] flex-col" aria-busy="true" aria-label="Chat wird geladen">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-night-border">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-5 w-5 rounded-full" />
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-hidden px-4 py-4">
        {PLACEHOLDER_BUBBLES.map((bubble, index) => (
          <div key={index} className={`flex ${bubble.own ? "justify-end" : "justify-start"}`}>
            <Skeleton
              className={`${bubble.width} max-w-[75%] rounded-2xl ${bubble.tall ? "h-24" : "h-9"}`}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-neutral-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-night-border">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-9 flex-1 rounded-full" />
        <Skeleton className="h-9 w-9 rounded-full" />
      </div>
    </main>
  );
}
