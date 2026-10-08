import api from './api';

export const resultService = {
  submitExam: (submissionData) => api.post('/results/submit', submissionData),
  saveExamProgress: (examId, data) => api.patch(`/results/attempts/${examId}/save`, data),
  getMyResults: () => api.get('/results/my-results'),
  getResultById: (id) => api.get(`/results/${id}`),
  getAllResultsAdmin: () => api.get('/results/admin/all'),
  getAdminResults: (params = {}) => api.get('/admin/results', { params }),
  overrideSubjectiveAnswer: (resultId, overrideData) => api.patch(`/results/${resultId}/subjective-override`, overrideData),
  getAnalyticsOverview: () => api.get('/analytics/overview'),

  // Export Job Management
  createExportJob: (data = {}) => api.post('/admin/results/export', data),
  getExportJobStatus: (jobId) => api.get(`/admin/results/export/${jobId}`),
  getExportHistory: (params = {}) => api.get('/admin/results/exports', { params }),

  downloadExportFile: async (jobId, fallbackFilename = null, format = 'csv') => {
    const exportFormat = format === 'xlsx' ? 'xlsx' : 'csv';
    const res = await api.get(`/admin/results/export/${jobId}/download`, {
      responseType: 'blob'
    });

    const rawBlob = res instanceof Blob ? res : (res?.data instanceof Blob ? res.data : new Blob([res]));

    if (rawBlob.type && (rawBlob.type === 'application/json' || rawBlob.type.includes('json'))) {
      const text = await rawBlob.text();
      let errorMsg = `Failed to download exported file`;
      try {
        const json = JSON.parse(text);
        if (json.message) errorMsg = json.message;
      } catch (e) {
        // ignore
      }
      throw new Error(errorMsg);
    }

    const mimeType = exportFormat === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv;charset=utf-8;';

    const fileBlob = new Blob([rawBlob], { type: mimeType });
    const url = window.URL.createObjectURL(fileBlob);
    const link = document.createElement('a');
    link.href = url;

    let downloadName = fallbackFilename;
    if (!downloadName) {
      const dateStr = new Date().toISOString().split('T')[0];
      downloadName = `GLB_ExamSphere_Results_${jobId}.${exportFormat}`;
    }
    if (!downloadName.endsWith(`.${exportFormat}`)) {
      downloadName = `${downloadName}.${exportFormat}`;
    }

    link.setAttribute('download', downloadName);
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 1500);
  },

  downloadResultPdf: async (id, fileName = 'Exam-Report.pdf') => {
    const res = await api.get(`/results/${id}/pdf`, { responseType: 'blob' });
    
    // api response interceptor returns response.data directly, which is the Blob
    const rawBlob = res instanceof Blob ? res : (res?.data instanceof Blob ? res.data : new Blob([res]));

    // If server returned a JSON error (e.g. unauthorized or not found), parse and throw
    if (rawBlob.type && (rawBlob.type === 'application/json' || rawBlob.type.includes('json'))) {
      const text = await rawBlob.text();
      let errorMsg = 'Failed to generate PDF test report';
      try {
        const json = JSON.parse(text);
        if (json.message) errorMsg = json.message;
      } catch (e) {
        // ignore
      }
      throw new Error(errorMsg);
    }

    const pdfBlob = new Blob([rawBlob], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(pdfBlob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Delay revocation to ensure browser has started the download stream
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 1500);
  },

  downloadResultsExport: async (params = {}, format = 'csv', fallbackFilename = null, onProgress = null) => {
    const exportFormat = format === 'xlsx' ? 'xlsx' : 'csv';

    // Step 1: Request asynchronous background export job
    try {
      const jobRes = await api.post('/admin/results/export', {
        ...params,
        format: exportFormat
      });

      const jobId = jobRes.jobId || jobRes.data?.jobId;
      if (!jobId) {
        throw new Error(jobRes.message || 'Failed to start export job');
      }

      if (onProgress) {
        onProgress({
          status: 'QUEUED',
          progressPercentage: 0,
          totalRecords: jobRes.totalRecords || jobRes.data?.totalRecords || 0,
          processedRecords: 0
        });
      }

      // Step 2: Poll export job until COMPLETED or FAILED
      let attempts = 0;
      const maxAttempts = 120; // 2 minutes maximum polling
      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;

        const statusRes = await api.get(`/admin/results/export/${jobId}`);
        const job = statusRes.job || statusRes.data?.job;

        if (job) {
          if (onProgress) {
            onProgress(job);
          }

          if (job.status === 'COMPLETED') {
            await resultService.downloadExportFile(jobId, fallbackFilename || job.fileName, exportFormat);
            return job;
          } else if (job.status === 'FAILED') {
            throw new Error(job.errorMessage || 'Export processing failed on server');
          } else if (job.status === 'CANCELLED' || job.status === 'EXPIRED') {
            throw new Error(`Export job was ${job.status.toLowerCase()}`);
          }
        }
      }
      throw new Error('Export generation timed out. You can download the completed file from Export History later.');
    } catch (jobErr) {
      // Fallback: If POST job creation fails due to legacy server or direct export, attempt direct GET export
      console.warn('Background export job fallback to direct stream:', jobErr.message);
      
      const queryParams = { ...params, format: exportFormat };
      const res = await api.get('/admin/results/export', {
        params: queryParams,
        responseType: 'blob'
      });

      const rawBlob = res instanceof Blob ? res : (res?.data instanceof Blob ? res.data : new Blob([res]));

      if (rawBlob.type && (rawBlob.type === 'application/json' || rawBlob.type.includes('json'))) {
        const text = await rawBlob.text();
        let errorMsg = `Failed to export results as ${exportFormat.toUpperCase()}`;
        try {
          const json = JSON.parse(text);
          if (json.message) errorMsg = json.message;
        } catch (e) {
          // ignore
        }
        throw new Error(errorMsg);
      }

      const mimeType = exportFormat === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv;charset=utf-8;';

      const fileBlob = new Blob([rawBlob], { type: mimeType });
      const url = window.URL.createObjectURL(fileBlob);
      const link = document.createElement('a');
      link.href = url;

      let downloadName = fallbackFilename;
      if (!downloadName) {
        const dateStr = new Date().toISOString().split('T')[0];
        downloadName = `GLB_ExamSphere_Results_${dateStr}.${exportFormat}`;
      }
      if (!downloadName.endsWith(`.${exportFormat}`)) {
        downloadName = `${downloadName}.${exportFormat}`;
      }

      link.setAttribute('download', downloadName);
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 1500);
    }
  }
};
