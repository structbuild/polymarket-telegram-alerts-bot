export const STALE_DRAFT_CALLBACK_MESSAGE = "This setup message is no longer active. Use the latest setup prompt.";

export function isActiveDraftCallbackMessage(
  draftMessageId: number | null | undefined,
  callbackMessageId: number | null | undefined
): boolean {
  return typeof draftMessageId === "number" &&
    typeof callbackMessageId === "number" &&
    draftMessageId === callbackMessageId;
}
