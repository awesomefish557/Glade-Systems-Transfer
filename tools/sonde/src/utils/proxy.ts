const PROXY_BASE = '/proxy?url='

export const proxied = (url: string) =>
  import.meta.env.VITE_USE_PROXY === 'true' ? PROXY_BASE + encodeURIComponent(url) : url
