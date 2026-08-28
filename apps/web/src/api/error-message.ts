type ApiErrorBody = {
  message?: string | string[] | { message?: string; errors?: string[] };
  errors?: string[];
  error?: string;
};

export function parseApiErrorMessage(value: string, fallback = "Request failed"): string {
  const text = value.trim();
  if (!text) return fallback;

  try {
    const body = JSON.parse(text) as ApiErrorBody;
    if (Array.isArray(body.errors) && body.errors.length) {
      return body.errors.join("\n");
    }
    if (
      body.message &&
      typeof body.message === "object" &&
      !Array.isArray(body.message) &&
      Array.isArray(body.message.errors) &&
      body.message.errors.length
    ) {
      return body.message.errors.join("\n");
    }
    if (Array.isArray(body.message) && body.message.length) {
      return body.message.join(". ");
    }
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    return text;
  }

  return fallback;
}
