export const DIGEST_PREFERENCE_CAP = 6;
export const READER_PREFERENCE_CAP = 9;
export const COMBINED_PREFERENCE_CAP = DIGEST_PREFERENCE_CAP + READER_PREFERENCE_CAP;

function clampPreference(value: number, cap: number) {
  return Math.max(-cap, Math.min(cap, Number.isFinite(value) ? value : 0));
}

export function digestScore(objectiveScore: number, feedAdjustment: number, preferenceAdjustment: number) {
  const preference = clampPreference(preferenceAdjustment, DIGEST_PREFERENCE_CAP);
  return {
    preference,
    score: objectiveScore + feedAdjustment + preference,
  };
}

export function readerScore(
  editorialScore: number,
  preferenceAdjustment: number,
  freshness: number,
  update: number,
) {
  const preference = clampPreference(preferenceAdjustment, READER_PREFERENCE_CAP);
  return {
    preference,
    score: editorialScore + preference + freshness + update,
  };
}
