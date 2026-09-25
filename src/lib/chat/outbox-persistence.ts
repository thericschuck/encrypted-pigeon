"use client";

// The outbox on disk (IndexedDB), so a message on its way survives the
// page being reloaded — which mobile browsers do on their own when an
// installed web app comes back from the background. Only what's needed to
// start the send over: the message fields and the original attachment.
// Everything here is best effort: no IndexedDB (private mode, storage
// blocked) just means the outbox lives in memory only, like before.

import type { MessageKind } from "@/lib/supabase/types";

const DB_NAME = "pigeon-outbox";
const STORE = "messages";
// Bigger originals aren't copied into IndexedDB (a 2 GB video would eat
// the storage quota); they still send, just not across a reload.
export const MAX_PERSISTED_ATTACHMENT_BYTES = 300 * 1024 * 1024;

export type PersistedAttachment =
  | { kind: "image" | "video"; blob: Blob; name: string; type: string }
  | { kind: "voice"; blob: Blob; durationSeconds: number; mimeType: string };

export interface PersistedMessage {
  id: string;
  chatId: string;
  senderId: string;
  kind: MessageKind;
  text: string | null;
  replyToId: string | null;
  createdAt: string;
  attachment: PersistedAttachment | null;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Resolves true once it's on disk. */
export async function persistMessage(message: PersistedMessage): Promise<boolean> {
  if (message.attachment && message.attachment.blob.size > MAX_PERSISTED_ATTACHMENT_BYTES) return false;
  return (await run("readwrite", (store) => store.put(message))) !== null;
}

export async function forgetPersistedMessage(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
}

export async function loadPersistedMessages(): Promise<PersistedMessage[]> {
  return ((await run("readonly", (store) => store.getAll())) as PersistedMessage[] | null) ?? [];
}
