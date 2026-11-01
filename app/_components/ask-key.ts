/**
 * The visitor's key for *Frag die Stadt* (ADR 0056), kept in the browser
 * only: for this tab (session storage) unless the visitor asks to keep it
 * on this device (local storage). With it the provider, the model and the
 * token the key check gave. The site's server never stores it.
 */
import {
  type AskProviderId,
  isAskModel,
  isAskProvider,
} from "@/lib/city/ask-city";
import { SESSION_KEYS, STORAGE_KEYS } from "./storage-keys";

export interface AskKey {
  /** ms epoch: when the token runs out */
  expires: number;
  key: string;
  model: string;
  provider: AskProviderId;
  /** kept on this device, not only for the tab */
  remember: boolean;
  token: string;
}

function parse(text: string | null, remember: boolean): AskKey | null {
  if (!text) {
    return null;
  }
  try {
    const v = JSON.parse(text) as Partial<AskKey>;
    if (
      isAskProvider(v.provider) &&
      isAskModel(v.provider, v.model) &&
      typeof v.key === "string" &&
      typeof v.token === "string" &&
      typeof v.expires === "number"
    ) {
      return {
        provider: v.provider,
        model: v.model as string,
        key: v.key,
        token: v.token,
        expires: v.expires,
        remember,
      };
    }
  } catch {
    // unreadable: as if none
  }
  return null;
}

/** The stored key, the tab's first; null without one. */
export function readAskKey(): AskKey | null {
  try {
    // remembered is what the device keeps, whichever copy is read
    const kept = localStorage.getItem(STORAGE_KEYS.askKey);
    return (
      parse(sessionStorage.getItem(SESSION_KEYS.askKey), kept !== null) ??
      parse(kept, true)
    );
  } catch {
    return null;
  }
}

/** Keeps the key where the visitor chose, and nowhere else. */
export function writeAskKey(value: AskKey): void {
  const { remember, ...rest } = value;
  const text = JSON.stringify(rest);
  try {
    sessionStorage.setItem(SESSION_KEYS.askKey, text);
    if (remember) {
      localStorage.setItem(STORAGE_KEYS.askKey, text);
    } else {
      localStorage.removeItem(STORAGE_KEYS.askKey);
    }
  } catch {
    // storage refused: the key lives in the card until the tab closes
  }
}

/** Forgets the key everywhere. */
export function clearAskKey(): void {
  try {
    sessionStorage.removeItem(SESSION_KEYS.askKey);
    localStorage.removeItem(STORAGE_KEYS.askKey);
  } catch {
    // nothing stored
  }
}
