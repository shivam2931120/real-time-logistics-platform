const localOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export function allowedWebOrigins() {
  const configured = (process.env.WEB_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean);
  return [...new Set([...configured, ...localOrigins])];
}
