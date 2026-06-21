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
import {
  applyReaderSourcePreset,
  isReaderSourceValidationError,
  isReaderSourcesSchemaError,
  readerSourceFromFormData,
  sourcePresetFromFormData,
  upsertReaderSource,
} from "./reader-sources";

function sourceSettingsRedirect(status: string, formData: FormData) {
  const sourceFeed = String(formData.get("sourceFeed") || "all");

  redirect(`/settings?status=${status}&sourceFeed=${encodeURIComponent(sourceFeed)}`);
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
    await upsertReaderDigestSettings(user.id, digestSettingsFromFormData(formData));
    revalidatePath("/");
    revalidatePath("/settings");
  } catch (error) {
    console.error("Failed to save digest settings:", errorMessage(error));
    status = isDigestSettingsSchemaError(error) ? "migration-required" : "save-failed";
  }

  redirect(`/settings?status=${status}`);
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
