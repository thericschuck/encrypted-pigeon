/**
 * There is exactly one admin: whoever's email matches ADMIN_EMAIL. Server-only
 * env var (no NEXT_PUBLIC_ prefix) — the admin identity never needs to reach
 * the browser.
 */
export function getAdminEmail(): string {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    throw new Error("ADMIN_EMAIL is not set");
  }
  return email;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase() === getAdminEmail().toLowerCase();
}
