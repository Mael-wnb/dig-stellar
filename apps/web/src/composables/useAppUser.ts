// src/composables/useAppUser.ts
import { ref } from "vue";

const STORAGE_USER_ID_KEY = "dig_stellar_user_id";

const userId = ref<string | null>(null);
const initialized = ref(false);

function restoreUser(): void {
  if (initialized.value) return;
  initialized.value = true;

  if (typeof window === "undefined") return;

  const storedUserId = window.localStorage.getItem(STORAGE_USER_ID_KEY);
  userId.value = storedUserId && storedUserId.trim().length > 0 ? storedUserId : null;

  console.log("[app-user] restoreUser", {
    storedUserId,
    currentUserId: userId.value,
  });
}

function setUserId(nextUserId: string): void {
  const normalizedUserId = nextUserId.trim();

  if (!normalizedUserId) {
    throw new Error("Cannot set empty userId");
  }

  userId.value = normalizedUserId;

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_USER_ID_KEY, normalizedUserId);
  }

  console.log("[app-user] setUserId", {
    userId: normalizedUserId,
    localStorageValue:
      typeof window !== "undefined"
        ? window.localStorage.getItem(STORAGE_USER_ID_KEY)
        : null,
  });
}

function clearUser(): void {
  userId.value = null;

  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_USER_ID_KEY);
  }

  console.log("[app-user] clearUser");
}

export function useAppUser() {
  restoreUser();

  return {
    userId,
    setUserId,
    clearUser,
    restoreUser,
  };
}