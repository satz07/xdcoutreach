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
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  getInvite: (token) => request(`/auth/invite/${encodeURIComponent(token)}`),
  setPassword: (token, password) =>
    request('/auth/set-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  me: () => request('/auth/me'),
  listUsers: () => request('/auth/users'),
  inviteUser: (email, email_send_limit) =>
    request('/auth/invite', {
      method: 'POST',
      body: JSON.stringify({
        email,
        email_send_limit:
          email_send_limit === '' || email_send_limit == null ? null : Number(email_send_limit),
      }),
    }),
  updateUser: (id, body) =>
    request(`/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deactivateUser: (id) => request(`/auth/users/${id}/deactivate`, { method: 'POST' }),
  resendInvite: (id) => request(`/auth/users/${id}/resend-invite`, { method: 'POST' }),
  events: () => request('/events'),
  createEvent: (body) => request('/events', { method: 'POST', body: JSON.stringify(body) }),
  updateEvent: (id, body) => request(`/events/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  aiStatus: () => request('/ai/status'),
  aiPersonalize: (body) => request('/ai/personalize', { method: 'POST', body: JSON.stringify(body) }),
  aiRuns: () => request('/ai/runs'),
  aiRun: (id) => request(`/ai/runs/${id}`),
  aiSendRun: (id, body) => request(`/ai/runs/${id}/send`, { method: 'POST', body: JSON.stringify(body) }),
  pulseMeta: (params = {}) => request(`/pulse/meta?${new URLSearchParams(params)}`),
  pulseSummary: (params = {}) => request(`/pulse/summary?${new URLSearchParams(params)}`),
  pulseItems: (params = {}) => request(`/pulse/items?${new URLSearchParams(params)}`),
  pulseBrief: (params = {}) => request(`/pulse/brief?${new URLSearchParams(params)}`),
  pulseGenerateBrief: (days, entity) =>
    request('/pulse/brief', { method: 'POST', body: JSON.stringify({ days, entity }) }),
  pulseRefresh: (entity) => request('/pulse/refresh', { method: 'POST', body: JSON.stringify({ entity }) }),
  pulseAddEntity: (body) => request('/pulse/entities', { method: 'POST', body: JSON.stringify(body) }),
  pulseUpdateEntity: (id, body) => request(`/pulse/entities/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  pulseRemoveEntity: (id) => request(`/pulse/entities/${id}`, { method: 'DELETE' }),
  pulseStartCompanyReport: (body) => request('/pulse/company-reports', { method: 'POST', body: JSON.stringify(body) }),
  pulseShare: () => request('/pulse/share'),
  pulseRotateShare: () => request('/pulse/share/rotate', { method: 'POST' }),
  mailProviders: () => request('/mail-providers'),
  createMailProvider: (body) =>
    request('/mail-providers', { method: 'POST', body: JSON.stringify(body) }),
  participants: (eventId, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/events/${eventId}/participants${q ? `?${q}` : ''}`);
  },
  addParticipants: (eventId, body) =>
    request(`/events/${eventId}/participants`, { method: 'POST', body: JSON.stringify(body) }),
  deleteParticipant: (eventId, pid) =>
    request(`/events/${eventId}/participants/${pid}`, { method: 'DELETE' }),
  queueParticipants: (eventId, body = {}) =>
    request(`/events/${eventId}/participants/queue`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  templates: (eventId) =>
    request(eventId ? `/templates?eventId=${eventId}` : '/templates'),
  updateTemplate: (id, body) =>
    request(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  preview: (content) =>
    request('/templates/preview', { method: 'POST', body: JSON.stringify({ content }) }),
  send: (body) => request('/send', { method: 'POST', body: JSON.stringify(body) }),
  sends: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/sends?${q}`);
  },
  suggestRecipients: (q, eventId) => {
    const params = new URLSearchParams({ q });
    if (eventId) params.set('eventId', eventId);
    return request(`/recipients/suggest?${params}`);
  },
  resend: (id) => request(`/sends/${id}/resend`, { method: 'POST' }),
  resendBulk: (ids) =>
    request('/sends/resend-bulk', { method: 'POST', body: JSON.stringify({ ids }) }),
  sendSelected: (ids) =>
    request('/sends/send-selected', { method: 'POST', body: JSON.stringify({ ids }) }),
  /** One-by-one transactional; marks sent only after Postmark Activity confirms */
  sendVerified: (ids) =>
    request('/sends/send-verified', { method: 'POST', body: JSON.stringify({ ids }) }),
  syncPending: (body = {}) =>
    request('/sends/sync-pending', { method: 'POST', body: JSON.stringify(body) }),
  importSends: (body) =>
    request('/sends/import', { method: 'POST', body: JSON.stringify(body) }),
  autoSendStatus: () => request('/sends/auto'),
  autoSendStart: (eventId, limit) =>
    request('/sends/auto/start', {
      method: 'POST',
      body: JSON.stringify({
        ...(eventId ? { eventId } : {}),
        ...(limit ? { limit: Number(limit) } : {}),
      }),
    }),
  autoSendStop: () => request('/sends/auto/stop', { method: 'POST', body: '{}' }),
  campaigns: (eventId) =>
    request(eventId ? `/campaigns?eventId=${eventId}` : '/campaigns'),

  meetForm: ({ token, event }) => {
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    if (event) params.set('event', event);
    return request(`/public/meet?${params}`);
  },
  submitMeet: (body) => request('/public/meet', { method: 'POST', body: JSON.stringify(body) }),

  leads: (filters = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    return request(`/leads?${params}`);
  },
  lead: (id) => request(`/leads/${id}`),
  updateLead: (id, body) => request(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  addLeadNote: (id, body) =>
    request(`/leads/${id}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
  deleteLead: (id) => request(`/leads/${id}`, { method: 'DELETE' }),
  leadOwners: () => request('/leads/owners'),
  leadSettings: (eventId) => request(`/leads/settings${eventId ? `?eventId=${eventId}` : ''}`),
  saveLeadSettings: (notifyEmails) =>
    request('/leads/settings', { method: 'PUT', body: JSON.stringify({ notifyEmails }) }),
};

/** Read-only data source for the Market Pulse dashboard: signed-in admin API or a public share link. */
export function pulseDataSource(shareToken) {
  if (!shareToken) {
    return {
      meta: api.pulseMeta,
      summary: api.pulseSummary,
      items: api.pulseItems,
      brief: api.pulseBrief,
      companyReports: () => request('/pulse/company-reports'),
      companyReport: (id) => request(`/pulse/company-reports/${id}`),
    };
  }
  const base = `/public/pulse/${encodeURIComponent(shareToken)}`;
  return {
    meta: (params = {}) => request(`${base}/meta?${new URLSearchParams(params)}`),
    summary: (params = {}) => request(`${base}/summary?${new URLSearchParams(params)}`),
    items: (params = {}) => request(`${base}/items?${new URLSearchParams(params)}`),
    brief: (params = {}) => request(`${base}/brief?${new URLSearchParams(params)}`),
    companyReports: () => request(`${base}/company-reports`),
    companyReport: (id) => request(`${base}/company-reports/${id}`),
  };
}

export function getPulseShareTokenFromUrl() {
  const m = /^\/pulse\/([A-Za-z0-9_-]{20,})\/?$/.exec(window.location.pathname);
  return m ? m[1] : '';
}

export function pulseShareUrl(token) {
  return `${window.location.origin}/pulse/${token}`;
}

export function getMeetParamsFromUrl() {
  try {
    const q = new URLSearchParams(window.location.search);
    if (!q.has('meet')) return null;
    return { token: q.get('meet') || '', event: q.get('event') || '' };
  } catch {
    return null;
  }
}

export function logoUrl(name) {
  return `${API_BASE}/logos/${name}`;
}

export function eventAssetUrl(eventSlug, name) {
  return `${API_BASE}/events/${eventSlug}/${name}`;
}

export function getInviteTokenFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('invite') || '';
  } catch {
    return '';
  }
}
