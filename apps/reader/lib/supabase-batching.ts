const SUPABASE_IN_FILTER_BATCH_SIZE = 100;

export function supabaseInFilterBatches(values: readonly string[]) {
  const batches: string[][] = [];

  for (let index = 0; index < values.length; index += SUPABASE_IN_FILTER_BATCH_SIZE) {
    batches.push(values.slice(index, index + SUPABASE_IN_FILTER_BATCH_SIZE));
  }

  return batches;
}
