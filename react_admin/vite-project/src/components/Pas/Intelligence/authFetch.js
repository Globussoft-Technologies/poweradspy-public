import Cookies from "js-cookie";

const LOGIN_PATH = "/";

function redirectToLogin() {
  if (typeof window === "undefined") return;
  if (window.location.pathname === LOGIN_PATH) return;
  Cookies.remove("token");
  Cookies.remove("nodeToken");
  window.location.assign(LOGIN_PATH);
}

export function getAuthToken() {
  return Cookies.get("token");
}

export function requireAuthOrRedirect() {
  const token = getAuthToken();
  if (!token) {
    redirectToLogin();
    return null;
  }
  return token;
}

export async function authFetch(url, options = {}) {
  const token = requireAuthOrRedirect();
  if (!token) throw new Error("Unauthorized");

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    redirectToLogin();
    throw new Error("Unauthorized");
  }
  return res;
}
