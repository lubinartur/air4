export const CHAT_REFRESH_EVENT = "air4:chat-refresh";

export function requestChatRefresh(): void {
  window.dispatchEvent(new CustomEvent(CHAT_REFRESH_EVENT));
}
