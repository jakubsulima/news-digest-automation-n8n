export type DnsAddress = { address: string; family: number };
export type DnsLookup = (hostname: string) => Promise<DnsAddress[]>;

export type SourceDiscoveryDependencies = {
  fetchImpl?: typeof fetch;
  lookup?: DnsLookup;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  userAgent?: string;
};

export type BoundedFetchResult = {
  body: string;
  contentType: string;
  finalUrl: string;
  redirectCount: number;
};

export type SourceDiscoveryProposal = {
  alreadyExists: boolean;
  canonicalHost: string;
  category: string;
  diagnostics: {
    alternateCandidateCount: number;
    duplicateRatio: number;
    inputUrl: string;
    redirectCount: number;
    sampleItemCount: number;
  };
  feedType: "rss" | "atom";
  feedUrl: string;
  language: string;
  name: string;
  sampleItemCount: number;
};
