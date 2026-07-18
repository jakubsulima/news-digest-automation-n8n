import { lookup as nodeLookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { DnsLookup } from "./types";

const BLOCKED_HOSTS = new Set([
  "instance-data.ec2.internal",
  "metadata.google.internal",
  "metadata.azure.internal",
  "metadata.internal",
]);

function ipv4Number(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inIpv4Range(value: number, base: string, prefix: number) {
  const baseValue = ipv4Number(base)!;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function blockedIpv4(address: string) {
  const value = ipv4Number(address);
  if (value === null) return true;
  return [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ].some(([base, prefix]) => inIpv4Range(value, base as string, prefix as number));
}

function expandIpv6(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  const mapped = normalized.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  let value = normalized;
  if (mapped) {
    const ipv4 = ipv4Number(mapped[2]);
    if (ipv4 === null) return null;
    value = `${mapped[1]}${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const parts = [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((part) => Number.parseInt(part || "0", 16));
  return parts.length === 8 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)
    ? parts
    : null;
}

function blockedIpv6(address: string) {
  const parts = expandIpv6(address);
  if (!parts) return true;
  if (parts.every((part) => part === 0) || (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1)) return true;
  if ((parts[0] & 0xfe00) === 0xfc00) return true;
  if ((parts[0] & 0xffc0) === 0xfe80) return true;
  if ((parts[0] & 0xff00) === 0xff00) return true;
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    return blockedIpv4(`${parts[6] >>> 8}.${parts[6] & 255}.${parts[7] >>> 8}.${parts[7] & 255}`);
  }
  // Public source fetching only permits current global-unicast space. This
  // rejects site-local, NAT64, IPv4-compatible and other special-use ranges.
  if ((parts[0] & 0xe000) !== 0x2000) return true;
  if (parts[0] === 0x2001 && parts[1] === 0x0000) return true;
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return true;
  if (parts[0] === 0x2002) return true;
  return false;
}

export function isBlockedAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? blockedIpv4(address) : family === 6 ? blockedIpv6(address) : true;
}

export const defaultDnsLookup: DnsLookup = async (hostname) =>
  nodeLookup(hostname, { all: true, verbatim: true });

export async function resolveRemoteUrl(rawUrl: string, lookup: DnsLookup = defaultDnsLookup) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Source URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS source URLs are supported.");
  }
  if (url.username || url.password) throw new Error("Source URLs cannot contain credentials.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Non-standard source URL ports are blocked.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || BLOCKED_HOSTS.has(hostname)) {
    throw new Error("Local and cloud metadata hosts are blocked.");
  }
  const literalFamily = isIP(hostname);
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await lookup(hostname);
  if (!addresses.length) throw new Error("Source host did not resolve to an address.");
  if (addresses.some((result) => isBlockedAddress(result.address))) {
    throw new Error("Source host resolves to a private, local, reserved, or metadata address.");
  }
  url.hash = "";
  return { addresses, url };
}

export async function validateRemoteUrl(rawUrl: string, lookup: DnsLookup = defaultDnsLookup) {
  return (await resolveRemoteUrl(rawUrl, lookup)).url;
}
