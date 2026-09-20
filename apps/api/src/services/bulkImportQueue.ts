import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type { BulkImportJobStatus, BulkImportJobSummary, BulkOrderImportResult, User } from "@routepulse/shared";
export type { BulkImportJobStatus, BulkImportJobSummary } from "@routepulse/shared";

export interface BulkImportJobPayload {
  user: User;
  csv: string;
}
type Processor = (payload: BulkImportJobPayload) => Promise<BulkOrderImportResult>;

const memory = new Map<string, BulkImportJobSummary>();
let queue: Queue<BulkImportJobPayload> | undefined;
let worker: Worker<BulkImportJobPayload> | undefined;
let connection: Redis | undefined;
let processor: Processor | undefined;

const useBull = () => process.env.QUEUE_MODE === "bullmq" && Boolean(process.env.REDIS_URL);
const now = () => new Date().toISOString();

export function configureBulkImportProcessor(next: Processor) {
  processor = next;
}

async function ensureBull() {
  if (!useBull() || !processor) return;
  connection ??= new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null, lazyConnect: true });
  if (connection.status === "wait") await connection.connect();
  queue ??= new Queue<BulkImportJobPayload>("bulk-order-imports", { connection });
  worker ??= new Worker<BulkImportJobPayload>(
    "bulk-order-imports",
    async (job) => {
      const existing = memory.get(job.id!);
      if (existing) {
        existing.status = "running";
        existing.updatedAt = now();
      }
      try {
        const result = await processor!(job.data);
        const summary = memory.get(job.id!);
        if (summary) Object.assign(summary, {
          status: "completed",
          totalRows: result.totalRows,
          validRows: result.validRows,
          invalidRows: result.invalidRows,
          result,
          updatedAt: now(),
        });
        return result;
      } catch (error) {
        const summary = memory.get(job.id!);
        if (summary) Object.assign(summary, { status: "failed", error: error instanceof Error ? error.message : "Bulk import failed", updatedAt: now() });
        throw error;
      }
    },
    { connection, concurrency: 2 },
  );
  worker.on("failed", (job, error) => {
    if (!job) return;
    const jobId = job.id;
    if (!jobId) return;
    const summary = memory.get(jobId);
    if (summary) Object.assign(summary, { status: "failed", error: error.message, updatedAt: now() });
  });
}

async function runInline(id: string, payload: BulkImportJobPayload) {
  const summary = memory.get(id);
  if (!summary || !processor) return;
  summary.status = "running";
  summary.updatedAt = now();
  try {
    const result = await processor(payload);
    Object.assign(summary, {
      status: "completed",
      totalRows: result.totalRows,
      validRows: result.validRows,
      invalidRows: result.invalidRows,
      result,
      updatedAt: now(),
    });
  } catch (error) {
    Object.assign(summary, { status: "failed", error: error instanceof Error ? error.message : "Bulk import failed", updatedAt: now() });
  }
}

export async function enqueueBulkImport(payload: BulkImportJobPayload) {
  if (!processor) throw new Error("Bulk import queue is not configured");
  const id = crypto.randomUUID();
  const timestamp = now();
  const summary: BulkImportJobSummary = { id, organizationId: payload.user.organizationId, status: "queued", createdAt: timestamp, updatedAt: timestamp };
  memory.set(id, summary);
  try {
    await ensureBull();
  } catch {
    // A transient Redis outage must not reject dispatch; the inline processor preserves the same contract.
    await closeBulkImportQueue();
  }
  if (queue) {
    await queue.add("bulk-order-import", payload, { jobId: id, attempts: 3, backoff: { type: "exponential", delay: 2_000 }, removeOnComplete: 100, removeOnFail: 100 });
  } else {
    void runInline(id, payload);
  }
  return summary;
}

function stateFromBull(job: Job<BulkImportJobPayload, BulkOrderImportResult, string>, state: BulkImportJobStatus): BulkImportJobSummary {
  const jobId = job.id;
  if (!jobId) throw new Error("Bulk import job is missing an id");
  const existing = memory.get(jobId);
  return existing || { id: jobId, organizationId: job.data.user.organizationId, status: state, createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : now(), updatedAt: now() };
}

export async function getBulkImportJob(id: string, organizationId: string) {
  const current = memory.get(id);
  if (current && current.organizationId === organizationId) return current;
  if (!queue) return undefined;
  const job = await queue.getJob(id);
  if (!job || job.data.user.organizationId !== organizationId) return undefined;
  const state = await job.getState();
  const summary = stateFromBull(job, state === "active" ? "running" : state === "completed" ? "completed" : state === "failed" ? "failed" : "queued");
  if (state === "completed") summary.result = job.returnvalue;
  if (state === "failed") summary.error = job.failedReason || "Bulk import failed";
  memory.set(id, summary);
  return summary;
}

export async function closeBulkImportQueue() {
  await worker?.close();
  await queue?.close();
  await connection?.quit();
  worker = undefined;
  queue = undefined;
  connection = undefined;
}
