import { BadRequestException } from '@nestjs/common';

/** Every adapter talks to somebody else's daemon over the network, so none of them may hang. */
const CLIENT_REQUEST_TIMEOUT_MS = 20_000;

/**
 * `new URL('/api/v2/...', base)` throws away any path the base carries, which silently breaks
 * every deployment where the client sits behind a reverse proxy at a subpath. Join under the
 * base's own path instead.
 */
export function endpointUrl(base: URL, path: string): URL {
  const prefix = base.pathname.replace(/\/+$/, '');
  const target = new URL(base.href);
  const [pathname, search] = path.split('?');
  target.pathname = `${prefix}${pathname}`;
  target.search = search ?? '';
  target.hash = '';
  return target;
}

/**
 * A timeout and a refusal both have to reach the operator as something they can act on, and
 * `fetch` reports them as the same opaque `TypeError`. `label` is the client's own name so the
 * settings form says which daemon went quiet when several are configured.
 */
export async function fetchClient(url: URL, init: RequestInit, label: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BadRequestException(`${label} did not answer in time`);
    }
    throw new BadRequestException(`Could not reach ${label}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The `Authorization` header for a client that authenticates per request rather than holding a
 * session. Omitted entirely when neither half is set, since a client with authentication switched
 * off answers an empty Basic header with a 401.
 */
export function basicAuthHeader(username: string | null, password: string | null): Record<string, string> {
  if (!username && !password) return {};
  return { Authorization: `Basic ${Buffer.from(`${username ?? ''}:${password ?? ''}`).toString('base64')}` };
}
