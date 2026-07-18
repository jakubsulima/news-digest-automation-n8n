export { fetchBoundedText } from "./bounded-fetch";
export { discoverSource } from "./discovery";
export { isBlockedAddress, validateRemoteUrl } from "./url-safety";
export type { SourceDiscoveryDependencies, SourceDiscoveryProposal } from "./types";

export async function discoverReaderSource(rawUrl: string) {
  const { discoverReaderSourceFromRepository } = await import("./repository");
  return discoverReaderSourceFromRepository(rawUrl);
}

export async function confirmReaderSourceDiscovery(input: {
  category: string;
  feedUrl: string;
  name: string;
  rawUrl: string;
}) {
  const { confirmReaderSourceFromRepository } = await import("./repository");
  return confirmReaderSourceFromRepository(input);
}
