import type { ProxyProtocol, ProxyProvider } from "@copify/shared";

export type ParsedProxyUrl = {
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string;
  password: string;
  provider: ProxyProvider;
};

export function parseProxyUrl(input: string): ParsedProxyUrl {
  const value = input.trim();
  if (!value || value.length > 2_048) throw new Error("Paste a proxy URL no longer than 2,048 characters.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Use a proxy URL such as http://username:password@host:port."); }
  const protocol = url.protocol.slice(0, -1);
  if (protocol !== "http" && protocol !== "https" && protocol !== "socks5") throw new Error("The proxy URL must use HTTP, HTTPS, or SOCKS5.");
  if (!url.hostname || !url.port) throw new Error("The proxy URL must include a host and explicit port.");
  if (!url.username || !url.password) throw new Error("The proxy URL must include both a username and password.");
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) throw new Error("The proxy URL cannot contain a path, query, or fragment.");
  let username: string; let password: string;
  try { username = decodeURIComponent(url.username); password = decodeURIComponent(url.password); } catch { throw new Error("The proxy URL contains invalid credential encoding."); }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("The proxy URL contains an invalid port.");
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  return { protocol, host, port, username, password, provider: /(^|\.)dataimpulse\.com$/i.test(host) ? "dataimpulse" : "custom" };
}

export function formatProxyUrl(protocol: ProxyProtocol, host: string, port: number, username: string | null, password: string | null): string {
  const authority = username !== null && password !== null ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : "";
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${protocol}://${authority}${formattedHost}:${port}`;
}
