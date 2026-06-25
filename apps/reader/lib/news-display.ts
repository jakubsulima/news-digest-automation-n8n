export function formatPracticalBucket(value: string) {
  return value.replace(/_/g, " ");
}

export function formatScoreComponentLabel(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}
