import type { ReplayData } from '../types';

export function parseReplayUrl(input: string): string {
  const trimmed = input.trim();
  // If it's already a full URL, extract the ID
  const match = trimmed.match(/replay\.pokemonshowdown\.com\/([a-z0-9-]+)/i);
  if (match) {
    return match[1];
  }
  // Assume it's a replay ID directly
  return trimmed;
}

export async function fetchReplay(urlOrId: string): Promise<ReplayData> {
  const id = parseReplayUrl(urlOrId);
  const url = `https://replay.pokemonshowdown.com/${id}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch replay: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
