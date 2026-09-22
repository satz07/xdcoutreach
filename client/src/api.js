const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const API = `${API_BASE}/api`;
const TOKEN_KEY = 'xdcoutreach_token';
const USER_KEY = 'xdcoutreach_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) {
    clearSession();
  }
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  health: () => request('/health'),
  requestOtp: (email) =>
    request('/auth/request-otp', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyOtp: (email, code) =>
    request('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, code }) }),
  me: () => request('/auth/me'),
  listUsers: () => request('/auth/users'),
  inviteUser: (email) =>
    request('/auth/invite', { method: 'POST', body: JSON.stringify({ email }) }),
  deactivateUser: (id) => request(`/auth/users/${id}/deactivate`, { method: 'POST' }),
  events: () => request('/events'),
  createEvent: (body) => request('/events', { method: 'POST', body: JSON.stringify(body) }),
  templates: (eventId) => request(eventId ? `/templates?eventId=${eventId}` : '/templates'),
  updateTemplate: (id, body) =>
    request(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  preview: (content) =>
    request('/templates/preview', { method: 'POST', body: JSON.stringify({ content }) }),
  send: (body) => request('/send', { method: 'POST', body: JSON.stringify(body) }),
  sends: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/sends?${q}`);
  },
  resend: (id) => request(`/sends/${id}/resend`, { method: 'POST' }),
  resendBulk: (ids) =>
    request('/sends/resend-bulk', { method: 'POST', body: JSON.stringify({ ids }) }),
  campaigns: () => request('/campaigns'),
};

export function logoUrl(name) {
  return `${API_BASE}/logos/${name}`;
}
