"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { retryFailedDigestRun } from "./digest-runs";
import {
  digestSettingsFromFormData,
  isDigestSettingsSchemaError,
  upsertReaderDigestSettings,
} from "./digest-settings";
import { errorMessage } from "./digest-builder/utils";
import { requireCurrentReader } from "./auth";
import { requireCurrentOperator } from "./operator";
import { getRecommendationPolicyGate } from "./recommendation-policy-server";
import { resetReaderPersonalization } from "./reader-feedback";
import {
  applyReaderSourcePreset,
  isReaderSourceValidationError,
  isReaderSourcesSchemaError,
  readerSourceFromFormData,
  readerSourcesFromFormData,
  sourcePresetFromFormData,
  upsertReaderSource,
  upsertReaderSources,
  setReaderSourceSelectionMode,
} from "./reader-sources";
import {
  applySourcePortfolioSuggestion,
  dismissSourcePortfolioSuggestion,
} from "./source-portfolio";
import { confirmReaderSourceDiscovery } from "./source-discovery";

function sourceSettingsRedirect(status: string, formData: FormData) {
  const sourceFeed = String(formData.get("sourceFeed") || "all");
  const settingsTab = String(formData.get("settingsTab") || "sources");
  const params = new URLSearchParams({ status, sourceFeed, settingsTab });

  redirect(`/settings?${params.toString()}`);
}

export async function retryDigestRun(digestRunId: string) {
  await requireCurrentOperator();
  await retryFailedDigestRun(digestRunId);
  revalidatePath("/");
}

export async function saveReaderDigestSettings(formData: FormData) {
  const user = await requireCurrentReader();
  let status = "saved";

  try {
    const settings = digestSettingsFromFormData(formData);
    if (settings.recommendationPolicyMode === "v2") {
      const gate = await getRecommendationPolicyGate();
      if (!gate.passed) {
        settings.recommendationPolicyMode = "shadow";
        status = "policy-gate-pending";
      }
    }
    await upsertReaderDigestSettings(user.id, settings);
    revalidatePath("/");
    revalidatePath("/settings");
  } catch (error) {
    console.error("Failed to save digest settings:", errorMessage(error));
    status = isDigestSettingsSchemaError(error) ? "migration-required" : "save-failed";
  }

  const settingsTab = String(formData.get("settingsTab") || "general");
  const params = new URLSearchParams({ status, settingsTab });

  redirect(`/settings?${params.toString()}`);
}

export async function resetPersonalization() {
  const user = await requireCurrentReader();
  await resetReaderPersonalization(user.id);
  revalidatePath("/");
  revalidatePath("/settings");
  redirect("/settings?settingsTab=advanced&status=personalization-reset");
}

export async function saveReaderSource(formData: FormData) {
  await requireCurrentOperator();
  let status = "source-saved";

  try {
    await upsertReaderSource(readerSourceFromFormData(formData));
    revalidatePath("/");
    revalidatePath("/settings");
  } catch (error) {
    console.error("Failed to save reader source:", errorMessage(error));
    status =
      isReaderSourcesSchemaError(error) || isReaderSourceValidationError(error)
        ? "source-invalid"
        : "source-save-failed";
  }

  sourceSettingsRedirect(status, formData);
}

export async function saveReaderSources(formData: FormData) {
  await requireCurrentOperator();
  let status = "sources-saved";

  try {
    await upsertReaderSources(readerSourcesFromFormData(formData));
    revalidatePath("/");
    revalidatePath("/settings");
  } catch (error) {
    console.error("Failed to save reader sources:", errorMessage(error));
    status =
      isReaderSourcesSchemaError(error) || isReaderSourceValidationError(error)
        ? "source-invalid"
        : "source-save-failed";
  }

  sourceSettingsRedirect(status, formData);
}

export async function saveReaderSourcePreset(formData: FormData) {
  await requireCurrentOperator();
  let status = "source-preset-saved";

  try {
    await applyReaderSourcePreset(sourcePresetFromFormData(formData));
    revalidatePath("/");
    revalidatePath("/settings");
  } catch (error) {
    console.error("Failed to apply reader source preset:", errorMessage(error));
    status = isReaderSourcesSchemaError(error) ? "source-invalid" : "source-save-failed";
  }

  sourceSettingsRedirect(status, formData);
}

export async function updateReaderSourceMode(formData: FormData) {
  await requireCurrentOperator();
  const sourceId = String(formData.get("sourceId") || "");
  const selectionMode = String(formData.get("selectionMode") || "");
  if (!sourceId || !["auto", "always_on", "blocked"].includes(selectionMode)) {
    throw new Error("Invalid source mode update.");
  }
  await setReaderSourceSelectionMode(
    sourceId,
    selectionMode as "auto" | "always_on" | "blocked",
  );
  revalidatePath("/settings");
}

export async function applyPortfolioSuggestion(formData: FormData) {
  await requireCurrentOperator();
  await applySourcePortfolioSuggestion(String(formData.get("decisionId") || ""));
  revalidatePath("/settings");
}

export async function dismissPortfolioSuggestion(formData: FormData) {
  await requireCurrentOperator();
  await dismissSourcePortfolioSuggestion(String(formData.get("decisionId") || ""));
  revalidatePath("/settings");
}

export async function startSourceDiscovery(formData: FormData) {
  await requireCurrentOperator();
  const rawUrl = String(formData.get("discoveryUrl") || "").trim();
  try {
    const url = new URL(rawUrl);
    if (rawUrl.length > 2_000 || !["http:", "https:"].includes(url.protocol)) throw new Error("Invalid URL");
  } catch {
    sourceSettingsRedirect("source-discovery-invalid", formData);
  }
  const params = new URLSearchParams({
    discoveryUrl: rawUrl,
    settingsTab: "sources",
    sourceFeed: String(formData.get("sourceFeed") || "geopolitics"),
  });
  redirect(`/settings?${params.toString()}`);
}

export async function confirmSourceDiscovery(formData: FormData) {
  await requireCurrentOperator();
  let status = "source-discovered";
  try {
    await confirmReaderSourceDiscovery({
      category: String(formData.get("category") || ""),
      feedUrl: String(formData.get("feedUrl") || ""),
      name: String(formData.get("name") || ""),
      rawUrl: String(formData.get("discoveryUrl") || ""),
    });
    revalidatePath("/");
    revalidatePath("/settings");
  } catch (error) {
    console.error("Failed to confirm discovered source:", errorMessage(error));
    status = "source-discovery-failed";
  }
  sourceSettingsRedirect(status, formData);
}
