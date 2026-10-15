/** Session unlock for the hidden bill builder (developer-only). */
export const BILL_BUILDER_UNLOCK_KEY = "dev.billBuilder.unlock";

/** Special key phrase — type this on Developer setup to unlock the builder. */
export const BILL_BUILDER_SPECIAL_KEY = "PIXAL-BILL";

export function isBillBuilderUnlocked() {
  try {
    return sessionStorage.getItem(BILL_BUILDER_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function unlockBillBuilder() {
  try {
    sessionStorage.setItem(BILL_BUILDER_UNLOCK_KEY, "1");
  } catch {
    /* */
  }
}

export function lockBillBuilder() {
  try {
    sessionStorage.removeItem(BILL_BUILDER_UNLOCK_KEY);
  } catch {
    /* */
  }
}
