export interface MagicLinkState {
  status: "idle" | "sent" | "error" | "redirect";
  message: string;
  // Only set when status is "redirect" — see PasswordLoginForm for why the
  // redirect happens client-side instead of via next/navigation's redirect()
  // inside the server action.
  redirectTo?: string;
}

export const initialMagicLinkState: MagicLinkState = {
  status: "idle",
  message: "",
};
