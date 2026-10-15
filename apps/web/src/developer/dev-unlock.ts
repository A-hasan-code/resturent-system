/** Session unlock for the Developer setup tab (hidden until special key). */
export const DEVELOPER_UNLOCK_KEY = "dev.setup.unlock";
export const DEVELOPER_UNLOCK_EVENT = "hotel:dev-unlock";

/** Special key phrase — or press Ctrl+Shift+D anywhere. */
export const DEVELOPER_SPECIAL_KEY = "PIXAL-DEV";

export function isDeveloperUnlocked() {
  try {
    return sessionStorage.getItem(DEVELOPER_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function unlockDeveloper() {
  try {
    sessionStorage.setItem(DEVELOPER_UNLOCK_KEY, "1");
  } catch {
    /* */
  }
  try {
    window.dispatchEvent(new Event(DEVELOPER_UNLOCK_EVENT));
  } catch {
    /* */
  }
}

export function lockDeveloper() {
  try {
    sessionStorage.removeItem(DEVELOPER_UNLOCK_KEY);
  } catch {
    /* */
  }
  try {
    window.dispatchEvent(new Event(DEVELOPER_UNLOCK_EVENT));
  } catch {
    /* */
  }
}
