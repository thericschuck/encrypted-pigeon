import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isNetworkError, resilientFetch } from "@/lib/supabase/resilient-fetch";

const PUBLIC_PATHS = [
  "/login",
  // /auth/callback (login links) and /auth/signout
  "/auth/",
  // PWA assets: fetched by the browser/OS to check install eligibility and
  // to register/update the service worker, both of which happen outside
  // any authenticated page context.
  "/manifest.json",
  "/icons",
  "/sw.js",
  "/workbox-",
  // Custom push worker + next-pwa's helper worker, importScripts()-ed by
  // sw.js — a redirect to /login here would fail the whole SW install.
  "/worker-",
  "/swe-worker-",
];

/**
 * Refreshes the Supabase auth session on every request (so Server Components
 * always see a valid, non-expired session via lib/supabase/server.ts) and
 * redirects signed-out users to /login for everything except the public
 * paths above.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: resilientFetch },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims() refreshes an expiring session (writing the new cookies via
  // setAll above) and then verifies the access token locally against the
  // project's cached JWKS (asymmetric ES256 keys) — no Auth-server round
  // trip on every request, unlike getUser().
  const { data, error } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? { id: data.claims.sub } : null;

  // Supabase unreachable (flaky network): that says nothing about whether
  // the user is signed in, so don't bounce them to /login — let the page
  // render and fail/retry on its own instead.
  if (!user && isNetworkError(error)) {
    return response;
  }

  const isPublicPath = PUBLIC_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );

  if (!user && !isPublicPath) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // A signed-in user on /login?error=... was sent there on purpose (e.g.
  // "/" found no chat for them) — bouncing them back to "/" would loop.
  if (
    user &&
    request.nextUrl.pathname === "/login" &&
    !request.nextUrl.searchParams.has("error")
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3)$).*)",
  ],
};
