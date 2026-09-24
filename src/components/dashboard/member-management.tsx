"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteMember, withdrawInvite, type AdminActionResult } from "@/app/admin/members/actions";
import { displayNameOf, type MemberProfile } from "@/lib/profile";
import { Avatar } from "@/components/ui/avatar";

interface MemberManagementProps {
  members: MemberProfile[];
  pendingInvites: { email: string; created_at: string }[];
}

/** Admin only: remove members (e.g. test accounts) and withdraw open invites. */
export function MemberManagement({ members, pendingInvites }: MemberManagementProps) {
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<AdminActionResult>) {
    setResult(null);
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      setConfirmingId(null);
      if (outcome.status === "ok") router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-4 dark:border-night-border dark:bg-night-surface">
      <div>
        <h2 className="text-sm font-semibold">Mitglieder</h2>
        <p className="mt-0.5 text-xs text-neutral-500 dark:text-night-muted">
          Löschen entfernt das Mitglied mit allen Chats, Nachrichten, Bildern und Sprachnachrichten.
          Das lässt sich nicht rückgängig machen.
        </p>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-night-muted">Noch niemand außer dir.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {members.map((member) => (
            <li key={member.id} className="flex flex-col gap-2 rounded-xl px-1 py-1.5">
              <div className="flex items-center gap-3">
                <Avatar profile={member} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{displayNameOf(member)}</p>
                  <p className="truncate text-xs text-neutral-400 dark:text-night-muted">{member.email}</p>
                </div>
                {confirmingId !== member.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setResult(null);
                      setConfirmingId(member.id);
                    }}
                    disabled={pending}
                    className="flex-shrink-0 rounded-full border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    Löschen
                  </button>
                )}
              </div>
              {confirmingId === member.id && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                  <span className="min-w-0 flex-1">
                    {displayNameOf(member)} und alle gemeinsamen Chats endgültig löschen?
                  </span>
                  <button
                    type="button"
                    onClick={() => run(() => deleteMember(member.id))}
                    disabled={pending}
                    className="rounded-full bg-red-600 px-3 py-1 font-medium text-white disabled:opacity-50"
                  >
                    {pending ? "Lösche…" : "Endgültig löschen"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    disabled={pending}
                    className="rounded-full px-2 py-1 underline disabled:opacity-50"
                  >
                    Abbrechen
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {pendingInvites.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-neutral-200 pt-3 dark:border-night-border">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-night-muted">
            Offene Einladungen
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
            {pendingInvites.map((invite) => (
              <li key={invite.email} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{invite.email}</span>
                <span className="flex flex-shrink-0 items-center gap-2 text-xs text-neutral-400 dark:text-night-muted">
                  seit {new Date(invite.created_at).toLocaleDateString("de-DE")}
                  <button
                    type="button"
                    onClick={() => run(() => withdrawInvite(invite.email))}
                    disabled={pending}
                    className="underline disabled:opacity-50"
                  >
                    Zurückziehen
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <p
          role={result.status === "error" ? "alert" : "status"}
          className={`text-xs ${
            result.status === "error" ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
