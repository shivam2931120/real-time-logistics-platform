const localOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
// Keep the hosted clients available even when Render has not yet received the
// WEB_ORIGIN override. The environment variable still supports additional
// preview/custom origins without weakening the allowlist to `*`.
const hostedOrigins = [
  'https://routepulse.justshivamm.in',
  'https://real-time-logistics-platform.vercel.app',
];

export function allowedWebOrigins() {
  const configured = (process.env.WEB_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean);
  return [...new Set([...configured, ...localOrigins, ...hostedOrigins])];
}
