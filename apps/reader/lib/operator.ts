import "server-only";

import { getCurrentReader, requireCurrentReader } from "./auth";

export async function getCurrentOperator() {
  return getCurrentReader();
}

export async function requireCurrentOperator() {
  return requireCurrentReader();
}
