/**
 * In-memory async job queue for background processing
 * Handles metric updates without blocking API responses
 */

// Job types enum
export enum JobType {
  UPDATE_POST_METRICS = "UPDATE_POST_METRICS",
  UPDATE_CREATOR_METRICS = "UPDATE_CREATOR_METRICS",
  CALCULATE_VIRALITY = "CALCULATE_VIRALITY",
  TRACK_INTERACTION = "TRACK_INTERACTION",
  UPDATE_TRENDING = "UPDATE_TRENDING",
  SYNC_GOVERNMENT_DATA = "SYNC_GOVERNMENT_DATA",
  GENERATE_REFERENCE_BRIEF = "GENERATE_REFERENCE_BRIEF",
  SYNC_REFERENCE_LINEAGE = "SYNC_REFERENCE_LINEAGE",
  REEXTRACT_REFERENCE_TEXT = "REEXTRACT_REFERENCE_TEXT",
}

// Priority levels
export enum JobPriority {
  HIGH = 0,
  NORMAL = 1,
  LOW = 2,
}

// Job status
export enum JobStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  DEAD = "DEAD",
}

// Job interface
export interface Job<T = unknown> {
  id: string;
  type: JobType;
  data: T;
  priority: JobPriority;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  error?: string;
  nextRetryAt?: Date;
}

// Job processor function type
export type JobProcessor<T = unknown> = (data: T) => Promise<void>;

// Queue statistics
export interface QueueStats {
  queueSize: number;
  processingCount: number;
  processedCount: number;
  failedCount: number;
  deadLetterCount: number;
  jobsByType: Record<JobType, number>;
  jobsByPriority: Record<JobPriority, number>;
}

// Job data types for type safety
export interface UpdatePostMetricsData {
  postId: string;
  interactionType?: string;
  dwellTimeMs?: number;
}

export interface UpdateCreatorMetricsData {
  userId: string;
}

export interface CalculateViralityData {
  postId: string;
}

export interface TrackInteractionData {
  userId: string;
  interactionType: string;
  postId?: string;
  targetUserId?: string;
  dwellTimeMs?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateTrendingData {
  category?: string;
  limit?: number;
}

export interface SyncGovernmentDataData {
  trigger: string;
}

/**
 * Re-pull one record's official text after a retrieval fix, without saying the
 * law changed. See the endpoint that queues these for why that distinction is
 * the whole point.
 */
export interface ReextractReferenceTextData {
  referenceId: string;
}

export interface GenerateReferenceBriefData {
  referenceId: string;
  force?: boolean;
}

export interface SyncReferenceLineageData {
  /** One record, or the whole sweep when absent. */
  referenceId?: string;
  trigger: string;
}

export interface BatchInteraction {
  userId: string;
  interactionType: string;
  postId?: string;
  targetUserId?: string;
  dwellTimeMs?: number;
  metadata?: Record<string, unknown>;
}

// Type mapping for job data
export type JobDataMap = {
  [JobType.UPDATE_POST_METRICS]: UpdatePostMetricsData;
  [JobType.UPDATE_CREATOR_METRICS]: UpdateCreatorMetricsData;
  [JobType.CALCULATE_VIRALITY]: CalculateViralityData;
  [JobType.TRACK_INTERACTION]: TrackInteractionData;
  [JobType.UPDATE_TRENDING]: UpdateTrendingData;
  [JobType.SYNC_GOVERNMENT_DATA]: SyncGovernmentDataData;
  [JobType.GENERATE_REFERENCE_BRIEF]: GenerateReferenceBriefData;
  [JobType.REEXTRACT_REFERENCE_TEXT]: ReextractReferenceTextData;
  [JobType.SYNC_REFERENCE_LINEAGE]: SyncReferenceLineageData;
};

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoffDelay(attempt: number): number {
  // Base delay of 1 second, doubles each attempt, max 30 seconds
  const baseDelay = 1000;
  const maxDelay = 30000;
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
  // Add jitter (0-500ms) to prevent thundering herd
  return delay + Math.random() * 500;
}

/**
 * Job Queue class for background processing
 */
export class JobQueue {
  private queues: Map<JobPriority, Job[]> = new Map([
    [JobPriority.HIGH, []],
    [JobPriority.NORMAL, []],
    [JobPriority.LOW, []],
  ]);

  private processors: Map<JobType, JobProcessor<unknown>> = new Map();
  private deadLetterQueue: Job[] = [];
  private processing: Set<string> = new Set();
  private isRunning: boolean = false;
  private processedCount: number = 0;
  private failedCount: number = 0;
  private concurrency: number;
  private processInterval: ReturnType<typeof setInterval> | null = null;
  private retryTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(concurrency: number = 3) {
    this.concurrency = concurrency;
  }

  /**
   * Register a processor for a specific job type
   */
  registerProcessor<T extends JobType>(
    jobType: T,
    processor: JobProcessor<JobDataMap[T]>
  ): void {
    this.processors.set(jobType, processor as JobProcessor<unknown>);
  }

  /**
   * Enqueue a new job
   */
  enqueue<T extends JobType>(
    type: T,
    data: JobDataMap[T],
    priority: JobPriority = JobPriority.NORMAL
  ): string {
    const job: Job<JobDataMap[T]> = {
      id: generateJobId(),
      type,
      data,
      priority,
      status: JobStatus.PENDING,
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(),
    };

    const queue = this.queues.get(priority);
    if (queue) {
      queue.push(job as Job);
    }

    // Trigger processing if running
    if (this.isRunning) {
      this.processNext();
    }

    return job.id;
  }

  /**
   * Get the next job to process (respects priority)
   */
  private getNextJob(): Job | null {
    // Check queues in priority order
    for (const priority of [JobPriority.HIGH, JobPriority.NORMAL, JobPriority.LOW]) {
      const queue = this.queues.get(priority);
      if (queue && queue.length > 0) {
        // Find first job that is pending and not waiting for retry
        const now = new Date();
        const jobIndex = queue.findIndex(
          (job) =>
            job.status === JobStatus.PENDING &&
            (!job.nextRetryAt || job.nextRetryAt <= now)
        );
        if (jobIndex !== -1) {
          return queue.splice(jobIndex, 1)[0] ?? null;
        }
      }
    }
    return null;
  }

  /**
   * Process the next available job
   */
  private async processNext(): Promise<void> {
    if (!this.isRunning) return;
    if (this.processing.size >= this.concurrency) return;

    const job = this.getNextJob();
    if (!job) return;

    this.processing.add(job.id);
    job.status = JobStatus.PROCESSING;
    job.processedAt = new Date();
    job.attempts++;

    const processor = this.processors.get(job.type);
    if (!processor) {
      console.error(`[JobQueue] No processor registered for job type: ${job.type}`);
      job.status = JobStatus.FAILED;
      job.error = `No processor registered for job type: ${job.type}`;
      this.moveToDeadLetter(job);
      this.processing.delete(job.id);
      this.processNext();
      return;
    }

    try {
      await processor(job.data);
      job.status = JobStatus.COMPLETED;
      job.completedAt = new Date();
      this.processedCount++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      job.error = errorMessage;
      console.error(
        `[JobQueue] Job ${job.id} (${job.type}) failed (attempt ${job.attempts}/${job.maxAttempts}): ${errorMessage}`
      );

      if (job.attempts < job.maxAttempts) {
        // Schedule retry with exponential backoff
        const delay = calculateBackoffDelay(job.attempts);
        job.status = JobStatus.PENDING;
        job.nextRetryAt = new Date(Date.now() + delay);

        // Re-add to queue
        const queue = this.queues.get(job.priority);
        if (queue) {
          queue.push(job);
        }

        // Schedule retry processing
        const timeoutId = setTimeout(() => {
          this.retryTimeouts.delete(job.id);
          this.processNext();
        }, delay);
        this.retryTimeouts.set(job.id, timeoutId);
      } else {
        // Move to dead letter queue after max attempts
        job.status = JobStatus.DEAD;
        this.moveToDeadLetter(job);
        this.failedCount++;
      }
    } finally {
      this.processing.delete(job.id);
      // Process next job
      this.processNext();
    }
  }

  /**
   * Move a job to the dead letter queue
   */
  private moveToDeadLetter(job: Job): void {
    this.deadLetterQueue.push(job);
    // Keep dead letter queue size manageable (max 1000 jobs)
    if (this.deadLetterQueue.length > 1000) {
      this.deadLetterQueue.shift();
    }
  }

  /**
   * Start processing jobs
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[JobQueue] Started with concurrency: ${this.concurrency}`);

    // Process initial jobs
    for (let i = 0; i < this.concurrency; i++) {
      this.processNext();
    }

    // Set up periodic processing for any jobs that might be waiting
    this.processInterval = setInterval(() => {
      if (this.processing.size < this.concurrency) {
        this.processNext();
      }
    }, 100);
  }

  /**
   * Stop processing jobs (drain current jobs)
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    console.log("[JobQueue] Stopping... waiting for current jobs to complete");

    // Clear the process interval
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }

    // Clear retry timeouts
    for (const timeout of Array.from(this.retryTimeouts.values())) {
      clearTimeout(timeout);
    }
    this.retryTimeouts.clear();

    // Wait for processing jobs to complete (with timeout)
    const maxWait = 30000; // 30 seconds
    const startTime = Date.now();
    while (this.processing.size > 0 && Date.now() - startTime < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.processing.size > 0) {
      console.warn(
        `[JobQueue] Stopped with ${this.processing.size} jobs still processing`
      );
    } else {
      console.log("[JobQueue] Stopped successfully");
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const jobsByType: Record<JobType, number> = {
      [JobType.UPDATE_POST_METRICS]: 0,
      [JobType.UPDATE_CREATOR_METRICS]: 0,
      [JobType.CALCULATE_VIRALITY]: 0,
      [JobType.TRACK_INTERACTION]: 0,
      [JobType.UPDATE_TRENDING]: 0,
      [JobType.SYNC_GOVERNMENT_DATA]: 0,
    [JobType.SYNC_REFERENCE_LINEAGE]: 0,
      [JobType.GENERATE_REFERENCE_BRIEF]: 0,
      [JobType.REEXTRACT_REFERENCE_TEXT]: 0,
    };

    const jobsByPriority: Record<JobPriority, number> = {
      [JobPriority.HIGH]: 0,
      [JobPriority.NORMAL]: 0,
      [JobPriority.LOW]: 0,
    };

    let totalQueueSize = 0;

    for (const [priority, queue] of Array.from(this.queues.entries())) {
      totalQueueSize += queue.length;
      jobsByPriority[priority] = queue.length;

      for (const job of queue) {
        jobsByType[job.type]++;
      }
    }

    return {
      queueSize: totalQueueSize,
      processingCount: this.processing.size,
      processedCount: this.processedCount,
      failedCount: this.failedCount,
      deadLetterCount: this.deadLetterQueue.length,
      jobsByType,
      jobsByPriority,
    };
  }

  /**
   * Get dead letter queue jobs
   */
  getDeadLetterQueue(): Job[] {
    return [...this.deadLetterQueue];
  }

  /**
   * Retry a dead letter job
   */
  retryDeadLetterJob(jobId: string): boolean {
    const jobIndex = this.deadLetterQueue.findIndex((j) => j.id === jobId);
    if (jobIndex === -1) return false;

    const job = this.deadLetterQueue.splice(jobIndex, 1)[0];
    if (!job) return false;

    // Reset job state
    job.status = JobStatus.PENDING;
    job.attempts = 0;
    job.error = undefined;
    job.nextRetryAt = undefined;
    job.processedAt = undefined;
    job.completedAt = undefined;

    // Re-add to queue
    const queue = this.queues.get(job.priority);
    if (queue) {
      queue.push(job);
    }

    if (this.isRunning) {
      this.processNext();
    }

    return true;
  }

  /**
   * Clear all jobs from queues
   */
  clear(): void {
    for (const queue of Array.from(this.queues.values())) {
      queue.length = 0;
    }
    this.deadLetterQueue.length = 0;
    this.processedCount = 0;
    this.failedCount = 0;
  }

  /**
   * Check if the queue is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

// Create singleton instance
export const jobQueue = new JobQueue(3);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Enqueue a post metrics update job
 */
export function enqueueMetricsUpdate(
  postId: string,
  interactionType?: string,
  dwellTimeMs?: number,
  priority: JobPriority = JobPriority.NORMAL
): string {
  return jobQueue.enqueue(
    JobType.UPDATE_POST_METRICS,
    { postId, interactionType, dwellTimeMs },
    priority
  );
}

/**
 * Enqueue a creator metrics update job
 */
export function enqueueCreatorUpdate(
  userId: string,
  priority: JobPriority = JobPriority.NORMAL
): string {
  return jobQueue.enqueue(
    JobType.UPDATE_CREATOR_METRICS,
    { userId },
    priority
  );
}

/**
 * Enqueue a batch of interaction tracking jobs
 */
export function enqueueBatchInteractions(
  interactions: BatchInteraction[],
  priority: JobPriority = JobPriority.NORMAL
): string[] {
  return interactions.map((interaction) =>
    jobQueue.enqueue(
      JobType.TRACK_INTERACTION,
      interaction,
      priority
    )
  );
}

/**
 * Enqueue a virality calculation job
 */
export function enqueueViralityCalculation(
  postId: string,
  priority: JobPriority = JobPriority.LOW
): string {
  return jobQueue.enqueue(
    JobType.CALCULATE_VIRALITY,
    { postId },
    priority
  );
}

/**
 * Enqueue a government data sync (bills, executive orders, SCOTUS cases)
 */
export function enqueueGovernmentSync(
  trigger: string,
  priority: JobPriority = JobPriority.LOW
): string {
  return jobQueue.enqueue(JobType.SYNC_GOVERNMENT_DATA, { trigger }, priority);
}

/**
 * Enqueue a lineage check: ask congress.gov which stored records are really the
 * same law. Low priority by design — it is one request per record against a key
 * the search shares, and nothing a reader is waiting for depends on it.
 */
export function enqueueLineageSync(
  trigger: string,
  referenceId?: string,
  priority: JobPriority = JobPriority.LOW
): string {
  return jobQueue.enqueue(JobType.SYNC_REFERENCE_LINEAGE, { trigger, referenceId }, priority);
}

/**
 * Enqueue a trending update job
 */
export function enqueueTrendingUpdate(
  category?: string,
  limit?: number,
  priority: JobPriority = JobPriority.LOW
): string {
  return jobQueue.enqueue(
    JobType.UPDATE_TRENDING,
    { category, limit },
    priority
  );
}

// ============================================================================
// Default Processors (can be overridden)
// ============================================================================

/**
 * Initialize default job processors
 * Call this function with the actual implementation functions
 */
export function initializeDefaultProcessors(processors: {
  updatePostMetrics?: (data: UpdatePostMetricsData) => Promise<void>;
  updateCreatorMetrics?: (data: UpdateCreatorMetricsData) => Promise<void>;
  calculateVirality?: (data: CalculateViralityData) => Promise<void>;
  trackInteraction?: (data: TrackInteractionData) => Promise<void>;
  updateTrending?: (data: UpdateTrendingData) => Promise<void>;
}): void {
  if (processors.updatePostMetrics) {
    jobQueue.registerProcessor(JobType.UPDATE_POST_METRICS, processors.updatePostMetrics);
  }

  if (processors.updateCreatorMetrics) {
    jobQueue.registerProcessor(JobType.UPDATE_CREATOR_METRICS, processors.updateCreatorMetrics);
  }

  if (processors.calculateVirality) {
    jobQueue.registerProcessor(JobType.CALCULATE_VIRALITY, processors.calculateVirality);
  }

  if (processors.trackInteraction) {
    jobQueue.registerProcessor(JobType.TRACK_INTERACTION, processors.trackInteraction);
  }

  if (processors.updateTrending) {
    jobQueue.registerProcessor(JobType.UPDATE_TRENDING, processors.updateTrending);
  }
}
