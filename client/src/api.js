const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const API = `${API_BASE}/api`;

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  health: () => request('/health'),
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
