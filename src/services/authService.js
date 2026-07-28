import { apiGet, apiPost } from "./api";
import { resetStoreSettingsCache } from "./storeSettingsService";

let currentUser = undefined;

const setCurrentUser = (user) => {
  currentUser = user;
  window.__CURRENT_USER__ = user;
  window.dispatchEvent(new CustomEvent("authChanged", { detail: user }));
  return user;
};

export const getCurrentUser = () => currentUser;
export const isAuthLoading = () => currentUser === undefined;

export const loadCurrentUser = async () => {
  try {
    const user = await apiGet("/api/auth/user");
    return setCurrentUser(user || null);
  } catch (err) {
    setCurrentUser(null);
    return null;
  }
};

export const canRegister = async () => {
  try {
    return await apiGet("/api/register/available");
  } catch (err) {
    return { available: false, isFirstUser: false };
  }
};

export const login = async (email, password) => {
  const user = await apiPost("/api/login", { email, password });
  return setCurrentUser(user || null);
};

export const register = async (registration) => {
  return apiPost("/api/register", registration);
};

export const logout = async () => {
  try {
    await apiPost("/api/logout", {});
  } catch (err) {
    console.warn("Logout request failed", err);
  }
  resetStoreSettingsCache();
  return setCurrentUser(null);
};

export const requestPasswordReset = async (email) => {
  return apiPost("/api/password-reset/request", { email });
};

export const confirmPasswordReset = async (email, token, password) => {
  return apiPost("/api/password-reset/confirm", { email, token, password });
};

export const updateCurrentUser = (updates) => {
  const user = getCurrentUser();
  const nextUser = user ? { ...user, ...updates } : null;
  return setCurrentUser(nextUser);
};
