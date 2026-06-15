import { z } from "zod";

export const readerNewsItemSchema = z.object({
  externalId: z.string().min(1).max(500),
  digestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1).max(500),
  summary: z.string().min(1).max(5000),
  source: z.string().min(1).max(200),
  sourceUrl: z.string().url().max(2000),
  category: z.string().min(1).max(100),
  importanceScore: z.number().int().min(0).max(100).optional(),
  publishedAt: z.string().datetime().optional(),
});

export const ingestPayloadSchema = z.union([
  readerNewsItemSchema,
  z.object({
    items: z.array(readerNewsItemSchema).min(1).max(100),
  }),
]);

export type ReaderNewsItemInput = z.infer<typeof readerNewsItemSchema>;

export function normalizeIngestPayload(payload: unknown): ReaderNewsItemInput[] {
  const parsed = ingestPayloadSchema.parse(payload);
  return "items" in parsed ? parsed.items : [parsed];
}
