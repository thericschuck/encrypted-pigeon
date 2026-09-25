"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ScheduleAvailability, ScheduleCategory } from "@/lib/supabase/types";
import {
  AVAILABILITY_INFO,
  AVAILABILITY_ORDER,
  CATEGORY_ORDER,
  SCHEDULE_BLOCK_COLUMNS,
  SCHEDULE_CATEGORIES,
  SLOT_MINUTES,
  blockTitle,
  type Occurrence,
  type Schedule,
  type ScheduleBlock,
  type ScheduleException,
} from "@/lib/schedule/schedule";
import {
  MINUTES_PER_DAY,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  browserTimeZone,
  formatDayMonth,
  formatMinute,
  mondayOf,
  weekdayOfKey,
  zoneLabel,
  zonedParts,
} from "@/lib/schedule/time";
import { useNow } from "@/lib/schedule/use-now";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { WeekGrid } from "@/components/schedule/week-grid";

const COMMON_ZONES = ["Asia/Shanghai", "Europe/Berlin"];
const SLOT_OPTIONS = Array.from({ length: MINUTES_PER_DAY / SLOT_MINUTES }, (_, i) => i * SLOT_MINUTES);

const CARD = "rounded-2xl border border-neutral-200 p-4 dark:border-night-border dark:bg-night-surface";
const INPUT =
  "rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-base focus:border-accent focus:outline-none sm:text-sm dark:border-night-border dark:bg-night-raised";
const PRIMARY_BUTTON =
  "rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-on-accent disabled:opacity-50";
const SECONDARY_BUTTON =
  "rounded-full px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-night-muted dark:hover:bg-night-raised";

/** Where a block lives: a weekday of the template, or an exception date. */
type Slot = { weekday: number } | { day: string };

interface Draft {
  id: string | null;
  category: ScheduleCategory;
  start: number;
  end: number;
  availability: ScheduleAvailability;
  label: string;
}

function allTimeZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    return [...COMMON_ZONES, ...zones.filter((z) => !COMMON_ZONES.includes(z))];
  } catch {
    return COMMON_ZONES;
  }
}

function blocksIn(blocks: ScheduleBlock[], slot: Slot) {
  return blocks
    .filter((b) => ("weekday" in slot ? b.weekday === slot.weekday : b.exception_day === slot.day))
    .sort((a, b) => a.start_minute - b.start_minute);
}

function copyOf(block: ScheduleBlock) {
  return {
    start_minute: block.start_minute,
    end_minute: block.end_minute,
    category: block.category,
    availability: block.availability,
    label: block.label,
  };
}

interface ScheduleEditorProps {
  userId: string;
  initialSchedule: Schedule;
  initialPublic: boolean;
  isAdmin: boolean;
}

export function ScheduleEditor({ userId, initialSchedule, initialPublic, isAdmin }: ScheduleEditorProps) {
  const router = useRouter();
  const now = useNow(60_000);
  const [blocks, setBlocks] = useState(initialSchedule.blocks);
  const [exceptions, setExceptions] = useState(initialSchedule.exceptions);
  const [timezone, setTimezone] = useState(initialSchedule.timezone);
  const [isPublic, setIsPublic] = useState(initialPublic);
  const [tab, setTab] = useState<"week" | "exceptions">("week");
  const [weekday, setWeekday] = useState(1);
  const [exceptionDay, setExceptionDay] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceZone, setDeviceZone] = useState<string | null>(null);
  const changedRef = useRef(false);

  const schedule: Schedule = { ownerId: userId, timezone, blocks, exceptions };
  const zones = useMemo(allTimeZones, []);
  const today = now ? zonedParts(now, timezone).dateKey : null;

  useEffect(() => setDeviceZone(browserTimeZone()), []);
  // Local state is the truth while editing — refreshing the route here
  // would remount the editor and lose the selected day. Once the editor is
  // left, drop the router cache so no page (dashboard, chat, this one via
  // back) shows a snapshot from before the changes.
  useEffect(() => {
    return () => {
      if (changedRef.current) router.refresh();
    };
  }, [router]);
  // Start on today's weekday once the time is known.
  useEffect(() => {
    if (today) setWeekday(weekdayOfKey(today));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today === null]);

  const slot: Slot | null = tab === "week" ? { weekday } : exceptionDay ? { day: exceptionDay } : null;
  const upcomingExceptions = exceptions
    .filter((e) => !today || e.day >= today)
    .sort((a, b) => a.day.localeCompare(b.day));

  /** Runs one change against Supabase; the UI only changes on success. */
  async function run(action: () => Promise<{ error: { message: string } | null } | void>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result && result.error) throw new Error(result.error.message);
      changedRef.current = true;
      return true;
    } catch (e) {
      setError(`Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startNewBlock() {
    if (!slot) return;
    const existing = blocksIn(blocks, slot);
    const start = existing.length > 0 ? existing[existing.length - 1].end_minute : 8 * 60;
    setDraft({
      id: null,
      category: "training",
      start,
      end: (start + 60) % MINUTES_PER_DAY,
      availability: SCHEDULE_CATEGORIES.training.defaultAvailability,
      label: "",
    });
  }

  function editBlock(block: ScheduleBlock) {
    setDraft({
      id: block.id,
      category: block.category,
      start: block.start_minute,
      end: block.end_minute,
      availability: block.availability,
      label: block.label ?? "",
    });
  }

  function selectFromGrid(occ: Occurrence) {
    const { block } = occ;
    if (block.weekday) {
      setTab("week");
      setWeekday(block.weekday);
    } else if (block.exception_day) {
      setTab("exceptions");
      setExceptionDay(block.exception_day);
    }
    editBlock(block);
  }

  async function saveDraft() {
    if (!draft || !slot) return;
    if (draft.start === draft.end) {
      setError("Start und Ende dürfen nicht gleich sein.");
      return;
    }
    const fields = {
      category: draft.category,
      start_minute: draft.start,
      end_minute: draft.end,
      availability: draft.availability,
      label: draft.label.trim() || null,
    };
    const supabase = createClient();
    const ok = await run(async () => {
      if (draft.id) {
        const { data, error } = await supabase
          .from("schedule_blocks")
          .update(fields)
          .eq("id", draft.id)
          .select(SCHEDULE_BLOCK_COLUMNS)
          .single();
        if (data) setBlocks((all) => all.map((b) => (b.id === data.id ? data : b)));
        return { error };
      }
      const { data, error } = await supabase
        .from("schedule_blocks")
        .insert({
          ...fields,
          owner_id: userId,
          weekday: "weekday" in slot ? slot.weekday : null,
          exception_day: "day" in slot ? slot.day : null,
        })
        .select(SCHEDULE_BLOCK_COLUMNS)
        .single();
      if (data) setBlocks((all) => [...all, data]);
      return { error };
    });
    if (ok) setDraft(null);
  }

  async function deleteDraft() {
    if (!draft?.id) return;
    const id = draft.id;
    const ok = await run(async () => {
      const { error } = await createClient().from("schedule_blocks").delete().eq("id", id);
      if (!error) setBlocks((all) => all.filter((b) => b.id !== id));
      return { error };
    });
    if (ok) setDraft(null);
  }

  async function copyWeekday(targets: number[]) {
    const source = blocksIn(blocks, { weekday });
    const supabase = createClient();
    return run(async () => {
      const { error: deleteError } = await supabase
        .from("schedule_blocks")
        .delete()
        .eq("owner_id", userId)
        .in("weekday", targets);
      if (deleteError) return { error: deleteError };
      const rows = targets.flatMap((target) =>
        source.map((b) => ({ ...copyOf(b), owner_id: userId, weekday: target }))
      );
      const { data, error } = rows.length
        ? await supabase.from("schedule_blocks").insert(rows).select(SCHEDULE_BLOCK_COLUMNS)
        : { data: [], error: null };
      setBlocks((all) => [...all.filter((b) => !b.weekday || !targets.includes(b.weekday)), ...(data ?? [])]);
      return { error };
    });
  }

  async function addException(day: string, note: string, fromTemplate: boolean) {
    const supabase = createClient();
    const ok = await run(async () => {
      const { data, error } = await supabase
        .from("schedule_exceptions")
        .insert({ owner_id: userId, day, note: note.trim() || null })
        .select("day, note")
        .single();
      if (error || !data) return { error };
      setExceptions((all) => [...all, data]);
      const template = blocksIn(blocks, { weekday: weekdayOfKey(day) });
      if (fromTemplate && template.length > 0) {
        const { data: copied, error: copyError } = await supabase
          .from("schedule_blocks")
          .insert(template.map((b) => ({ ...copyOf(b), owner_id: userId, exception_day: day })))
          .select(SCHEDULE_BLOCK_COLUMNS);
        setBlocks((all) => [...all, ...(copied ?? [])]);
        return { error: copyError };
      }
      return { error: null };
    });
    if (ok) {
      setExceptionDay(day);
      setDraft(null);
    }
  }

  async function saveExceptionNote(exception: ScheduleException, note: string) {
    const value = note.trim() || null;
    if (value === exception.note) return;
    await run(async () => {
      const { error } = await createClient()
        .from("schedule_exceptions")
        .update({ note: value })
        .eq("owner_id", userId)
        .eq("day", exception.day);
      if (!error) setExceptions((all) => all.map((e) => (e.day === exception.day ? { ...e, note: value } : e)));
      return { error };
    });
  }

  async function deleteException(day: string) {
    const ok = await run(async () => {
      // Its blocks go with it (on delete cascade).
      const { error } = await createClient().from("schedule_exceptions").delete().eq("owner_id", userId).eq("day", day);
      if (!error) {
        setExceptions((all) => all.filter((e) => e.day !== day));
        setBlocks((all) => all.filter((b) => b.exception_day !== day));
      }
      return { error };
    });
    if (ok) {
      setExceptionDay(null);
      setDraft(null);
    }
  }

  async function changeTimezone(zone: string) {
    const previous = timezone;
    setTimezone(zone);
    const ok = await run(async () => createClient().from("profiles").update({ timezone: zone }).eq("id", userId));
    if (!ok) setTimezone(previous);
  }

  async function changePublic(value: boolean) {
    setIsPublic(value);
    const ok = await run(async () => createClient().rpc("set_schedule_public", { p_user_id: userId, p_public: value }));
    if (!ok) setIsPublic(!value);
  }

  const selectedException = exceptionDay ? exceptions.find((e) => e.day === exceptionDay) ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      <section className={`${CARD} flex flex-col gap-3`}>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Zeitzone deines Plans</span>
          <select value={timezone} onChange={(e) => void changeTimezone(e.target.value)} disabled={busy} className={INPUT}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <span className="text-xs text-neutral-500 dark:text-night-muted">
            Du trägst alle Zeiten in dieser Zone ein. Die anderen sehen sie automatisch in ihrer eigenen Zeit.
          </span>
        </label>
        {deviceZone && deviceZone !== timezone && (
          <p className="text-xs text-neutral-500 dark:text-night-muted">
            Dein Gerät steht auf {zoneLabel(deviceZone)}.{" "}
            <button type="button" onClick={() => void changeTimezone(deviceZone)} className="underline">
              Übernehmen
            </button>
          </p>
        )}
        {isAdmin ? (
          <div className="flex items-center justify-between gap-3 border-t border-neutral-100 pt-3 dark:border-night-border">
            <div>
              <p className="text-sm font-medium">Für alle Mitglieder sichtbar</p>
              <p className="text-xs text-neutral-500 dark:text-night-muted">
                Aus: nur du siehst deinen Plan. Die Pläne der anderen siehst du immer.
              </p>
            </div>
            <ToggleSwitch checked={isPublic} onChange={(v) => void changePublic(v)} label="Für alle Mitglieder sichtbar" disabled={busy} />
          </div>
        ) : (
          <p className="border-t border-neutral-100 pt-3 text-xs text-neutral-500 dark:border-night-border dark:text-night-muted">
            {isPublic ? "Alle Mitglieder sehen deinen Plan." : "Deinen Plan sehen nur du und der Admin."}
          </p>
        )}
      </section>

      {error && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Hinweis schließen" className="flex-shrink-0">
            ✕
          </button>
        </div>
      )}

      <div className="flex rounded-full bg-neutral-100 p-0.5 text-sm dark:bg-night-raised">
        {(
          [
            { value: "week", label: "Normale Woche" },
            { value: "exceptions", label: "Ausnahmen" },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setTab(option.value);
              setDraft(null);
            }}
            aria-pressed={tab === option.value}
            className={`flex-1 rounded-full px-3 py-1.5 ${
              tab === option.value ? "bg-white font-medium shadow-sm dark:bg-night-surface" : "text-neutral-500 dark:text-night-muted"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {tab === "week" && (
        <section className={`${CARD} flex flex-col gap-3`}>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_SHORT.map((label, i) => {
              const day = i + 1;
              const count = blocksIn(blocks, { weekday: day }).length;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setWeekday(day);
                    setDraft(null);
                  }}
                  aria-pressed={weekday === day}
                  className={`flex flex-col items-center rounded-xl py-1.5 text-xs ${
                    weekday === day ? "bg-accent font-semibold text-on-accent" : "hover:bg-neutral-100 dark:hover:bg-night-raised"
                  }`}
                >
                  {label}
                  <span className="text-[10px] opacity-70">{count || "–"}</span>
                </button>
              );
            })}
          </div>
          <DayBlocks
            title={WEEKDAY_LONG[weekday - 1]}
            blocks={blocksIn(blocks, { weekday })}
            editingId={draft?.id ?? null}
            onEdit={editBlock}
          />
          {draft ? (
            <BlockForm draft={draft} onChange={setDraft} onSave={saveDraft} onDelete={deleteDraft} onCancel={() => setDraft(null)} busy={busy} />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={startNewBlock} className={PRIMARY_BUTTON}>
                + Eintrag
              </button>
              {blocksIn(blocks, { weekday }).length > 0 && <CopyDay from={weekday} busy={busy} onCopy={copyWeekday} />}
            </div>
          )}
        </section>
      )}

      {tab === "exceptions" && (
        <section className={`${CARD} flex flex-col gap-3`}>
          <p className="text-xs text-neutral-500 dark:text-night-muted">
            An einem Ausnahme-Tag gilt nur, was du dort einträgst. Die normale Woche wird dann ignoriert, etwa bei
            Ausflügen, Prüfungen oder freien Tagen.
          </p>
          {upcomingExceptions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {upcomingExceptions.map((exception) => (
                <button
                  key={exception.day}
                  type="button"
                  onClick={() => {
                    setExceptionDay(exception.day);
                    setDraft(null);
                  }}
                  aria-pressed={exceptionDay === exception.day}
                  className={`rounded-full px-3 py-1 text-xs ${
                    exceptionDay === exception.day
                      ? "bg-accent font-semibold text-on-accent"
                      : "bg-neutral-100 hover:bg-neutral-200 dark:bg-night-raised dark:hover:bg-night-border"
                  }`}
                >
                  {WEEKDAY_SHORT[weekdayOfKey(exception.day) - 1]} {formatDayMonth(exception.day)}
                  {exception.note && ` · ${exception.note}`}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setExceptionDay(null);
                  setDraft(null);
                }}
                className="rounded-full px-3 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:text-night-muted dark:hover:bg-night-raised"
              >
                + Neue Ausnahme
              </button>
            </div>
          )}

          {selectedException ? (
            <>
              <div className="flex flex-col gap-2 border-t border-neutral-100 pt-3 dark:border-night-border">
                <p className="text-sm font-semibold">
                  {WEEKDAY_LONG[weekdayOfKey(selectedException.day) - 1]}, {formatDayMonth(selectedException.day)}
                </p>
                <input
                  key={selectedException.day}
                  defaultValue={selectedException.note ?? ""}
                  onBlur={(e) => void saveExceptionNote(selectedException, e.target.value)}
                  placeholder="Notiz, z.B. Ausflug zum Songshan"
                  maxLength={80}
                  className={INPUT}
                />
              </div>
              <DayBlocks
                title="Einträge"
                blocks={blocksIn(blocks, { day: selectedException.day })}
                editingId={draft?.id ?? null}
                onEdit={editBlock}
                emptyText="Keine Einträge, der Tag gilt als frei."
              />
              {draft ? (
                <BlockForm draft={draft} onChange={setDraft} onSave={saveDraft} onDelete={deleteDraft} onCancel={() => setDraft(null)} busy={busy} />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={startNewBlock} className={PRIMARY_BUTTON}>
                    + Eintrag
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteException(selectedException.day)}
                    className={`${SECONDARY_BUTTON} text-red-600 dark:text-red-400`}
                  >
                    Ausnahme löschen
                  </button>
                </div>
              )}
            </>
          ) : (
            <NewException
              minDay={today}
              taken={exceptions.map((e) => e.day)}
              busy={busy}
              onAdd={(day, note, fromTemplate) => void addException(day, note, fromTemplate)}
            />
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-night-muted">
          So sieht deine Woche aus ({zoneLabel(timezone)})
        </h2>
        {today ? (
          <WeekGrid
            schedule={schedule}
            displayZone={timezone}
            weekStart={mondayOf(today)}
            now={now}
            selectedBlockId={draft?.id}
            onSelect={selectFromGrid}
          />
        ) : (
          <div className="h-[60dvh] animate-pulse rounded-2xl bg-neutral-100 dark:bg-night-surface" />
        )}
      </section>
    </div>
  );
}

function DayBlocks({
  title,
  blocks,
  editingId,
  onEdit,
  emptyText = "Noch keine Einträge.",
}: {
  title: string;
  blocks: ScheduleBlock[];
  editingId: string | null;
  onEdit: (block: ScheduleBlock) => void;
  emptyText?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      {blocks.length === 0 ? (
        <p className="text-xs text-neutral-500 dark:text-night-muted">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {blocks.map((block) => {
            const category = SCHEDULE_CATEGORIES[block.category];
            return (
              <li key={block.id}>
                <button
                  type="button"
                  onClick={() => onEdit(block)}
                  className={`flex w-full items-center gap-2 rounded-xl border-l-4 px-3 py-2 text-left text-sm ${category.blockClass} ${
                    editingId === block.id ? "ring-2 ring-[#c1643a] dark:ring-night-accent" : ""
                  }`}
                >
                  <span className="w-[5.5rem] flex-shrink-0 text-xs tabular-nums">
                    {formatMinute(block.start_minute)}–{formatMinute(block.end_minute)}
                    {block.end_minute <= block.start_minute && <sup> +1</sup>}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {category.emoji} {blockTitle(block)}
                  </span>
                  <span
                    title={AVAILABILITY_INFO[block.availability].label}
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${AVAILABILITY_INFO[block.availability].dotClass}`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BlockForm({
  draft,
  onChange,
  onSave,
  onDelete,
  onCancel,
  busy,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onDelete: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const wraps = draft.end <= draft.start;

  return (
    <div className="animate-fade-in flex flex-col gap-3 rounded-xl bg-neutral-50 p-3 dark:bg-night-raised">
      <div className="flex flex-wrap gap-1.5">
        {CATEGORY_ORDER.map((value) => {
          const category = SCHEDULE_CATEGORIES[value];
          const active = draft.category === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              // A new category brings its usual availability along.
              onClick={() => onChange({ ...draft, category: value, availability: category.defaultAvailability })}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                active ? category.blockClass : "border-neutral-200 bg-white dark:border-night-border dark:bg-night-surface"
              }`}
            >
              {category.emoji} {category.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5">
          Von
          <select value={draft.start} onChange={(e) => onChange({ ...draft, start: Number(e.target.value) })} className={INPUT}>
            {SLOT_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {formatMinute(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          bis
          <select value={draft.end} onChange={(e) => onChange({ ...draft, end: Number(e.target.value) })} className={INPUT}>
            {SLOT_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {formatMinute(m)}
              </option>
            ))}
          </select>
        </label>
        {wraps && draft.end !== draft.start && (
          <span className="text-xs text-neutral-500 dark:text-night-muted">endet am nächsten Tag</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500 dark:text-night-muted">Erreichbarkeit</span>
        <div className="flex rounded-full bg-white p-0.5 text-xs dark:bg-night-surface">
          {AVAILABILITY_ORDER.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={draft.availability === value}
              onClick={() => onChange({ ...draft, availability: value })}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1 ${
                draft.availability === value
                  ? "bg-neutral-100 font-medium dark:bg-night-raised"
                  : "text-neutral-500 dark:text-night-muted"
              }`}
            >
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${AVAILABILITY_INFO[value].dotClass}`} />
              {value === "available" ? "erreichbar" : value === "limited" ? "eingeschränkt" : "nicht erreichbar"}
            </button>
          ))}
        </div>
      </div>

      <input
        value={draft.label}
        onChange={(e) => onChange({ ...draft, label: e.target.value })}
        placeholder={`Bezeichnung (optional), sonst „${SCHEDULE_CATEGORIES[draft.category].label}“`}
        maxLength={60}
        className={INPUT}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onSave} disabled={busy} className={PRIMARY_BUTTON}>
          {busy ? "Speichert…" : "Speichern"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={SECONDARY_BUTTON}>
          Abbrechen
        </button>
        {draft.id && (
          <button type="button" onClick={onDelete} disabled={busy} className={`${SECONDARY_BUTTON} ml-auto text-red-600 dark:text-red-400`}>
            Löschen
          </button>
        )}
      </div>
    </div>
  );
}

function CopyDay({ from, busy, onCopy }: { from: number; busy: boolean; onCopy: (targets: number[]) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<number[]>([]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={SECONDARY_BUTTON}>
        Tag kopieren…
      </button>
    );
  }

  return (
    <div className="animate-fade-in flex w-full flex-col gap-2 rounded-xl bg-neutral-50 p-3 dark:bg-night-raised">
      <p className="text-xs text-neutral-600 dark:text-night-muted">
        {WEEKDAY_LONG[from - 1]} übernehmen für (ersetzt die Einträge dort):
      </p>
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAY_SHORT.map((label, i) => {
          const day = i + 1;
          if (day === from) return null;
          const active = targets.includes(day);
          return (
            <button
              key={label}
              type="button"
              aria-pressed={active}
              onClick={() => setTargets((t) => (active ? t.filter((d) => d !== day) : [...t, day]))}
              className={`rounded-full px-3 py-1 text-xs ${
                active ? "bg-accent font-semibold text-on-accent" : "bg-white dark:bg-night-surface"
              }`}
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setTargets([1, 2, 3, 4, 5].filter((d) => d !== from))}
          className="rounded-full px-3 py-1 text-xs text-neutral-500 underline dark:text-night-muted"
        >
          Mo–Fr
        </button>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || targets.length === 0}
          onClick={async () => {
            if (await onCopy(targets)) {
              setOpen(false);
              setTargets([]);
            }
          }}
          className={PRIMARY_BUTTON}
        >
          Kopieren
        </button>
        <button type="button" onClick={() => setOpen(false)} className={SECONDARY_BUTTON}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

function NewException({
  minDay,
  taken,
  busy,
  onAdd,
}: {
  minDay: string | null;
  taken: string[];
  busy: boolean;
  onAdd: (day: string, note: string, fromTemplate: boolean) => void;
}) {
  const [day, setDay] = useState("");
  const [note, setNote] = useState("");
  const [fromTemplate, setFromTemplate] = useState(true);
  const duplicate = taken.includes(day);

  return (
    <div className="flex flex-col gap-2 border-t border-neutral-100 pt-3 dark:border-night-border">
      <h3 className="text-sm font-semibold">Neue Ausnahme</h3>
      <div className="flex flex-wrap gap-2">
        <input type="date" value={day} min={minDay ?? undefined} onChange={(e) => setDay(e.target.value)} className={INPUT} />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Notiz, z.B. Prüfung"
          maxLength={80}
          className={`${INPUT} min-w-0 flex-1`}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-night-muted">
        <input type="checkbox" checked={fromTemplate} onChange={(e) => setFromTemplate(e.target.checked)} />
        Mit den normalen Einträgen dieses Wochentags starten
      </label>
      {duplicate && <p className="text-xs text-red-600 dark:text-red-400">Für diesen Tag gibt es schon eine Ausnahme.</p>}
      <div>
        <button
          type="button"
          disabled={busy || !day || duplicate}
          onClick={() => onAdd(day, note, fromTemplate)}
          className={PRIMARY_BUTTON}
        >
          Ausnahme anlegen
        </button>
      </div>
    </div>
  );
}
