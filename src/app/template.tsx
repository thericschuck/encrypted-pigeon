/**
 * Re-mounts on navigation between top-level sections (dashboard, chat,
 * settings, login), giving each a short fade-in. Switching between two chats
 * stays within /chat, so the sidebar and chat don't flash.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-in">{children}</div>;
}
