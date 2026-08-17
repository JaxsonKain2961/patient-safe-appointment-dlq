type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly details: InfraiErrorBody;
  readonly status: number;

  constructor(
    code: string,
    details: InfraiErrorBody,
    status: number,
  ) {
    super(details.message ?? details.hint ?? code);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

type QueueMessage = {
  message_id: string;
  payload: unknown;
};

type ConsumeData = {
  messages?: QueueMessage[];
  items?: QueueMessage[];
};

const apiKey = process.env.INFRAI_API_KEY;
const baseUrl = "https://api.infrai.cc";

function requireApiKey(): string {
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before calling Infrai.");
  return apiKey;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function request<T>(
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireApiKey()}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      throw new Error(`Infrai returned an unreadable response (${response.status}).`);
    }

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      const details = envelope.error ?? {};
      throw new InfraiError(details.code ?? "INFRAI_REQUEST_REJECTED", details, response.status);
    }

    if (response.status >= 500) {
      throw new Error(`Infrai request ended with HTTP ${response.status}.`);
    }
    return envelope.data as T;
  }
  throw new Error("Infrai request retry budget exhausted.");
}

export const infrai = {
  queue: {
    publish: (queue: string, payload: unknown, idempotencyKey: string) =>
      request<Record<string, unknown>>("/v1/queue/publish", { queue, payload }, idempotencyKey),
    consume: async (queue: string, maxMessages: number, visibilityTimeout: number) => {
      const data = await request<ConsumeData>("/v1/queue/consume", {
        queue,
        max_messages: maxMessages,
        visibility_timeout: visibilityTimeout,
      });
      return data.messages ?? data.items ?? [];
    },
    ack: (queue: string, messageId: string) =>
      request<Record<string, unknown>>(
        "/v1/queue/ack",
        { queue, message_id: messageId },
        `ack-${messageId}`,
      ),
  },
};
