import type { AuthenticatedUser, ModelDetail, ModelProvider } from "./types";

export const PREMIUM_MODEL_ACCESS_DENIED_MESSAGE =
  "该模型仅限非普通用户角色使用，请切换至高级角色后重试。";
export const PREMIUM_MODEL_FALLBACK_NOTICE =
  "您的高级模型权限已不可用，当前对话已自动切换为默认模型。";

export function hasPremiumModelAccess(
  role: AuthenticatedUser["role"] | null | undefined,
): boolean {
  const normalizedRole = role?.trim().toLowerCase() ?? "";
  return normalizedRole.length > 0 && normalizedRole !== "user";
}

export function isModelLockedForRole(
  model: Pick<ModelDetail, "requires_premium">,
  role: AuthenticatedUser["role"] | null | undefined,
): boolean {
  return model.requires_premium && !hasPremiumModelAccess(role);
}

export function findModelSelection(
  providers: ModelProvider[],
  value: string | null,
): { provider: ModelProvider; model: ModelDetail } | null {
  const normalizedValue = (value ?? "").trim();
  if (!normalizedValue) {
    return null;
  }

  for (const provider of providers) {
    for (const model of provider.models) {
      if (model.id === normalizedValue || model.model === normalizedValue) {
        return { provider, model };
      }
    }
  }

  return null;
}

export function getPreferredConfiguredModel(
  providers: ModelProvider[],
  role: AuthenticatedUser["role"] | null | undefined,
): ModelDetail | null {
  for (const provider of providers) {
    if (provider.status !== "configured") {
      continue;
    }

    const defaultModel = provider.models.find(
      (model) => model.is_default && !isModelLockedForRole(model, role),
    );
    if (defaultModel) {
      return defaultModel;
    }
  }

  for (const provider of providers) {
    if (provider.status !== "configured") {
      continue;
    }

    const firstAccessibleModel = provider.models.find(
      (model) => !isModelLockedForRole(model, role),
    );
    if (firstAccessibleModel) {
      return firstAccessibleModel;
    }
  }

  return null;
}
