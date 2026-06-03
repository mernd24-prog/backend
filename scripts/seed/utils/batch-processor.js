/**
 * Batch Processor for Efficient Seed Data Import
 * Handles chunking, transaction management, and error recovery
 */

class BatchProcessor {
  constructor(batchSize = 1000) {
    this.batchSize = batchSize;
    this.currentBatch = [];
    this.totalProcessed = 0;
    this.totalFailed = 0;
  }

  /**
   * Process data in batches
   */
  async processBatch(data, processor, options = {}) {
    const {
      onBatchComplete = null,
      onError = null,
      retryAttempts = 3,
      transactional = false,
    } = options;

    const batches = this.chunksArray(data, this.batchSize);
    let processedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        const result = await this.executeBatch(batch, processor, retryAttempts, transactional);
        processedCount += result.success;
        failedCount += result.failed;

        if (onBatchComplete) {
          onBatchComplete({
            batchNumber: i + 1,
            totalBatches: batches.length,
            batchProcessed: result.success,
            batchFailed: result.failed,
            totalProcessed: processedCount,
            totalFailed: failedCount,
          });
        }
      } catch (error) {
        failedCount += batch.length;
        if (onError) {
          onError(error, i + 1, batches.length);
        }
      }
    }

    this.totalProcessed = processedCount;
    this.totalFailed = failedCount;

    return {
      success: processedCount,
      failed: failedCount,
      total: processedCount + failedCount,
    };
  }

  /**
   * Execute single batch with retry logic
   */
  async executeBatch(batch, processor, retryAttempts = 3, transactional = false) {
    let attempt = 0;
    let lastError;

    while (attempt < retryAttempts) {
      try {
        if (transactional && processor.transaction) {
          return await processor.transaction(batch);
        } else {
          return await processor.process(batch);
        }
      } catch (error) {
        attempt++;
        lastError = error;
        if (attempt < retryAttempts) {
          await this.delay(1000 * attempt); // Exponential backoff
        }
      }
    }

    throw lastError;
  }

  /**
   * Process data with stream for very large datasets
   */
  async processStream(dataSource, processor, options = {}) {
    const { onProgress = null, batchSize = this.batchSize } = options;
    let processed = 0;
    let failed = 0;

    try {
      for await (const batch of dataSource) {
        const items = Array.isArray(batch) ? batch : [batch];
        try {
          await processor.process(items);
          processed += items.length;
        } catch (error) {
          failed += items.length;
        }

        if (onProgress) {
          onProgress({ processed, failed });
        }
      }
    } catch (error) {
      throw new Error(`Stream processing failed: ${error.message}`);
    }

    return { processed, failed };
  }

  /**
   * Chunk array into smaller arrays
   */
  chunksArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Delay helper for retry logic
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get processing stats
   */
  getStats() {
    return {
      processed: this.totalProcessed,
      failed: this.totalFailed,
      total: this.totalProcessed + this.totalFailed,
      successRate: this.totalProcessed + this.totalFailed > 0 
        ? ((this.totalProcessed / (this.totalProcessed + this.totalFailed)) * 100).toFixed(2) + '%'
        : '0%',
    };
  }
}

module.exports = BatchProcessor;
