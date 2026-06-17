import { createClient } from "@supabase/supabase-js";

const ENTITY_BY_NAME = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};
const PAGE_SIZE = 100;

const tableConfigs = [
  {
    columns: ["title", "summary"],
    name: "news_items",
  },
  {
    columns: ["title", "raw_summary", "enriched_title", "enriched_description", "enriched_text"],
    name: "articles",
  },
  {
    columns: ["canonical_title", "latest_summary"],
    name: "story_clusters",
  },
];

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function decodeCodePoint(value) {
  try {
    return Number.isFinite(value) ? String.fromCodePoint(value) : "";
  } catch {
    return "";
  }
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity) => {
      const normalized = entity.toLowerCase();

      if (normalized.startsWith("#x")) {
        return decodeCodePoint(Number.parseInt(normalized.slice(2), 16)) || match;
      }

      if (normalized.startsWith("#")) {
        return decodeCodePoint(Number.parseInt(normalized.slice(1), 10)) || match;
      }

      return ENTITY_BY_NAME[normalized] ?? match;
    });
}

function plainTextFromHtml(value) {
  let text = value;

  for (let index = 0; index < 2; index += 1) {
    text = decodeHtmlEntities(text).replace(/<[^>]+>/g, " ");
  }

  return text.replace(/\s+/g, " ").trim();
}

async function cleanupTable(supabase, config) {
  let scanned = 0;
  let changed = 0;

  for (;;) {
    const from = scanned;
    const to = scanned + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(config.name)
      .select(["id", ...config.columns].join(", "))
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`${config.name}: ${error.message}`);
    }

    if (!data?.length) {
      break;
    }

    for (const row of data) {
      const updates = {};

      for (const column of config.columns) {
        const value = row[column];

        if (typeof value !== "string") {
          continue;
        }

        const cleaned = plainTextFromHtml(value);

        if (cleaned !== value) {
          updates[column] = cleaned;
        }
      }

      if (!Object.keys(updates).length) {
        continue;
      }

      const { error: updateError } = await supabase.from(config.name).update(updates).eq("id", row.id);

      if (updateError) {
        throw new Error(`${config.name} ${row.id}: ${updateError.message}`);
      }

      changed += 1;
    }

    scanned += data.length;

    if (data.length < PAGE_SIZE) {
      break;
    }
  }

  return { changed, scanned };
}

const supabase = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

for (const config of tableConfigs) {
  const result = await cleanupTable(supabase, config);
  console.log(`${config.name}: scanned ${result.scanned}, changed ${result.changed}`);
}
