const fs = require('fs');
const path = require('path');

const EXPORT_DIR = process.env.EXPORT_STORAGE_DIR 
  ? path.resolve(process.env.EXPORT_STORAGE_DIR)
  : path.join(__dirname, '..', 'uploads', 'exports');

// Ensure exports directory exists
try {
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }
} catch (err) {
  console.error('[ExportStorage] Failed to initialize export storage directory:', err);
}

class ExportStorageService {
  /**
   * Return the absolute export directory path
   */
  static getExportDir() {
    if (!fs.existsSync(EXPORT_DIR)) {
      fs.mkdirSync(EXPORT_DIR, { recursive: true });
    }
    return EXPORT_DIR;
  }

  /**
   * Get safe absolute file path within the export storage directory to prevent directory traversal
   */
  static getSafePath(fileName) {
    const sanitized = path.basename(fileName);
    return path.join(this.getExportDir(), sanitized);
  }

  /**
   * Check if an export file exists on disk
   */
  static exists(filePath) {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  /**
   * Create a readable stream for file download
   */
  static getDownloadStream(filePath) {
    if (!this.exists(filePath)) {
      throw new Error('Export file not found or has expired');
    }
    return fs.createReadStream(filePath);
  }

  /**
   * Create a writable stream for saving file chunks
   */
  static getWriteStream(filePath) {
    return fs.createWriteStream(filePath, { flags: 'w', encoding: 'utf8' });
  }

  /**
   * Delete an export file from disk
   */
  static async deleteFile(filePath) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
    } catch (err) {
      console.warn(`[ExportStorage] Could not delete file: ${filePath}`, err.message);
    }
    return false;
  }

  /**
   * Cleanup expired files and jobs from disk
   */
  static async cleanupExpiredExports(ExportJobModel) {
    try {
      const now = new Date();
      const expiredJobs = await ExportJobModel.find({
        expiresAt: { $lt: now },
        status: { $ne: 'EXPIRED' }
      }).limit(500);

      let cleanedCount = 0;
      for (const job of expiredJobs) {
        if (job.filePath) {
          await this.deleteFile(job.filePath);
        }
        job.status = 'EXPIRED';
        await job.save();
        cleanedCount++;
      }

      if (cleanedCount > 0) {
        console.log(`[ExportStorage] Cleaned up ${cleanedCount} expired export jobs.`);
      }
      return cleanedCount;
    } catch (err) {
      console.error('[ExportStorage] Error during expired exports cleanup:', err.message);
      return 0;
    }
  }
}

module.exports = ExportStorageService;
