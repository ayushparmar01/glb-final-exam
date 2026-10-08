import React, { useState, useEffect, useCallback } from 'react';
import { resultService } from '../../services/resultService';
import { academicService } from '../../services/academicService';
import { examService } from '../../services/examService';
import {
  Eye,
  X,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Download,
  Loader2,
  Filter,
  RefreshCw,
  Search,
  FileSpreadsheet,
  FileText,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Award,
  AlertCircle,
  Sparkles,
  Edit,
  History,
  Clock,
  HardDrive
} from 'lucide-react';

const ResultsList = () => {
  // Data States
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  // Filter States
  const [search, setSearch] = useState('');
  const [examFilter, setExamFilter] = useState('ALL');
  const [academicYearFilter, setAcademicYearFilter] = useState('ALL');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [semesterFilter, setSemesterFilter] = useState('ALL');
  const [sectionFilter, setSectionFilter] = useState('ALL');
  const [batchFilter, setBatchFilter] = useState('ALL');
  const [subjectFilter, setSubjectFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Dropdown Master Options
  const [exams, setExams] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [branches, setBranches] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [sections, setSections] = useState([]);
  const [batches, setBatches] = useState([]);
  const [subjects, setSubjects] = useState([]);

  // Modal & Download States
  const [selectedResult, setSelectedResult] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [exportingType, setExportingType] = useState(null); // 'csv' | 'xlsx' | null
  const [exportProgress, setExportProgress] = useState(null); // { format, status, progressPercentage, totalRecords, processedRecords }
  const [toastMessage, setToastMessage] = useState(null); // { type: 'success'|'error', text: '' }

  // Export History Modal States
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [exportHistoryList, setExportHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyDownloadingJobId, setHistoryDownloadingJobId] = useState(null);

  const showToast = (text, type = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4500);
  };

  // Load Dropdown Options (Exams & Academic Master Data)
  useEffect(() => {
    const loadMasterOptions = async () => {
      try {
        const [masterRes, examsRes] = await Promise.all([
          academicService.getMasterOptions().catch(() => ({ data: {} })),
          examService.getAllExams().catch(() => ({ data: [] }))
        ]);

        if (masterRes?.data) {
          setAcademicYears(masterRes.data.academicYears || []);
          setBranches(masterRes.data.branches || []);
          setSemesters(masterRes.data.semesters || []);
          setSections(masterRes.data.sections || []);
          setBatches(masterRes.data.batches || []);
          setSubjects(masterRes.data.subjects || []);
        }

        if (examsRes?.data) {
          setExams(Array.isArray(examsRes.data) ? examsRes.data : (examsRes.data?.exams || []));
        }
      } catch (err) {
        console.error('Failed to load filter options:', err);
      }
    };
    loadMasterOptions();
  }, []);

  // Build active filter parameters object
  const getFilterParams = useCallback(() => {
    const params = {};
    if (search && search.trim()) params.search = search.trim();
    if (examFilter && examFilter !== 'ALL') params.examId = examFilter;
    if (academicYearFilter && academicYearFilter !== 'ALL') params.academicYearId = academicYearFilter;
    if (branchFilter && branchFilter !== 'ALL') params.branch = branchFilter;
    if (semesterFilter && semesterFilter !== 'ALL') params.semester = semesterFilter;
    if (sectionFilter && sectionFilter !== 'ALL') params.section = sectionFilter;
    if (batchFilter && batchFilter !== 'ALL') params.batch = batchFilter;
    if (subjectFilter && subjectFilter !== 'ALL') params.subjectId = subjectFilter;
    if (statusFilter && statusFilter !== 'ALL') params.status = statusFilter;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    return params;
  }, [
    search,
    examFilter,
    academicYearFilter,
    branchFilter,
    semesterFilter,
    sectionFilter,
    batchFilter,
    subjectFilter,
    statusFilter,
    startDate,
    endDate
  ]);

  // Fetch paginated results from backend
  const fetchResults = useCallback(async (targetPage = page) => {
    try {
      setLoading(true);
      const params = {
        ...getFilterParams(),
        page: targetPage,
        limit
      };
      const res = await resultService.getAdminResults(params);
      const dataList = res.results || res.data || [];
      setResults(dataList);
      setTotalCount(res.totalCount !== undefined ? res.totalCount : (res.pagination?.total || dataList.length));
      setTotalPages(res.totalPages || res.pagination?.totalPages || 1);
    } catch (err) {
      console.error('Failed to fetch results:', err);
      showToast(err.message || 'Failed to load results', 'error');
    } finally {
      setLoading(false);
    }
  }, [getFilterParams, page, limit]);

  useEffect(() => {
    fetchResults(page);
  }, [page, limit, fetchResults]);

  // Handle Apply Filter button
  const handleApplyFilters = (e) => {
    if (e) e.preventDefault();
    setPage(1);
    fetchResults(1);
  };

  // Handle Reset Filter button
  const handleResetFilters = () => {
    setSearch('');
    setExamFilter('ALL');
    setAcademicYearFilter('ALL');
    setBranchFilter('ALL');
    setSemesterFilter('ALL');
    setSectionFilter('ALL');
    setBatchFilter('ALL');
    setSubjectFilter('ALL');
    setStatusFilter('ALL');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  // Handle Export CSV with Live Progress
  const handleExportCsv = async () => {
    try {
      setExportingType('csv');
      setExportProgress({
        format: 'csv',
        status: 'QUEUED',
        progressPercentage: 0,
        processedRecords: 0,
        totalRecords: totalCount
      });
      const params = getFilterParams();
      const dateStr = new Date().toISOString().split('T')[0];
      let filename = `GLB_ExamSphere_Results_${dateStr}.csv`;
      if (branchFilter !== 'ALL' && semesterFilter !== 'ALL') {
        filename = `GLB_ExamSphere_${branchFilter}_Sem${semesterFilter}_Results_${dateStr}.csv`;
      }
      await resultService.downloadResultsExport(params, 'csv', filename, (progress) => {
        setExportProgress((prev) => ({
          ...prev,
          ...progress,
          format: 'csv'
        }));
      });
      showToast('CSV export downloaded successfully!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to export CSV', 'error');
    } finally {
      setExportingType(null);
      setTimeout(() => setExportProgress(null), 3500);
    }
  };

  // Handle Export Excel (.xlsx) with Live Progress
  const handleExportExcel = async () => {
    try {
      setExportingType('xlsx');
      setExportProgress({
        format: 'xlsx',
        status: 'QUEUED',
        progressPercentage: 0,
        processedRecords: 0,
        totalRecords: totalCount
      });
      const params = getFilterParams();
      const dateStr = new Date().toISOString().split('T')[0];
      let filename = `GLB_ExamSphere_Results_${dateStr}.xlsx`;
      if (branchFilter !== 'ALL' && semesterFilter !== 'ALL') {
        filename = `GLB_ExamSphere_${branchFilter}_Sem${semesterFilter}_Results_${dateStr}.xlsx`;
      }
      await resultService.downloadResultsExport(params, 'xlsx', filename, (progress) => {
        setExportProgress((prev) => ({
          ...prev,
          ...progress,
          format: 'xlsx'
        }));
      });
      showToast('Excel (.xlsx) export downloaded successfully!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to export Excel', 'error');
    } finally {
      setExportingType(null);
      setTimeout(() => setExportProgress(null), 3500);
    }
  };

  // Fetch Export History
  const fetchExportHistory = async (targetPage = 1) => {
    try {
      setHistoryLoading(true);
      const res = await resultService.getExportHistory({ page: targetPage, limit: 8 });
      const jobList = res.jobs || res.data?.jobs || [];
      setExportHistoryList(jobList);
      setHistoryTotalPages(res.totalPages || res.data?.totalPages || 1);
      setHistoryPage(targetPage);
    } catch (err) {
      showToast(err.message || 'Failed to load export history', 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistoryModal = () => {
    setHistoryModalOpen(true);
    fetchExportHistory(1);
  };

  const handleDownloadHistoryJob = async (job) => {
    try {
      setHistoryDownloadingJobId(job.jobId);
      await resultService.downloadExportFile(job.jobId, job.fileName, job.format);
      showToast(`Downloaded ${job.fileName || 'export file'}`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to download export file', 'error');
    } finally {
      setHistoryDownloadingJobId(null);
    }
  };

  // Handle Individual PDF Download
  const handleDownloadPdf = async (resItem) => {
    try {
      setDownloadingId(resItem._id);
      const studentName = (resItem.studentName || resItem.studentId?.name || 'Student').replace(/[^a-zA-Z0-9_-]/g, '_');
      const examTitle = (resItem.examName || resItem.examId?.title || 'Exam').replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${studentName}_${examTitle}_Report_${String(resItem._id).slice(-6)}.pdf`;
      await resultService.downloadResultPdf(resItem._id, fileName);
    } catch (err) {
      showToast(err.message || 'Failed to download report PDF', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  // Open detailed answer breakdown modal
  const openResultDetail = async (id) => {
    try {
      setModalLoading(true);
      const res = await resultService.getResultById(id);
      setSelectedResult(res.data);
    } catch (err) {
      showToast(err.message || 'Failed to load result details', 'error');
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '3rem' }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '1.5rem',
            right: '1.5rem',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.9rem 1.4rem',
            borderRadius: 'var(--radius-md)',
            background: toastMessage.type === 'error' ? '#FEE2E2' : '#DCFCE7',
            border: `1px solid ${toastMessage.type === 'error' ? '#FCA5A5' : '#86EFAC'}`,
            color: toastMessage.type === 'error' ? '#991B1B' : '#166534',
            boxShadow: 'var(--shadow-lg)',
            fontSize: '0.92rem',
            fontWeight: 600,
            animation: 'slideInRight 0.25s ease'
          }}
        >
          {toastMessage.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          {toastMessage.text}
        </div>
      )}

      {/* Page Header */}
      <div style={{ marginBottom: '1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.2rem 0.65rem',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              color: '#059669',
              fontSize: '0.74rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              marginBottom: '0.5rem'
            }}
          >
            <ShieldCheck size={13} />
            ADMIN RESULTS & LARGE SCALE EXPORT
          </div>
          <h1 style={{ fontSize: '1.85rem', color: '#0F172A', marginBottom: '0.3rem' }}>Results Management</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.925rem' }}>
            Multi-dimensional exam performance records, server-side streaming exports, and background job queue
          </p>
        </div>

        {/* Action Export Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <button
            onClick={openHistoryModal}
            className="btn btn-secondary"
            style={{ padding: '0.6rem 1.1rem', fontSize: '0.875rem' }}
            title="View Past Export Files and Download History"
          >
            <History size={16} />
            Export History
          </button>

          <button
            onClick={handleExportCsv}
            disabled={exportingType !== null || loading}
            className="btn btn-secondary"
            style={{ padding: '0.6rem 1.1rem', fontSize: '0.875rem' }}
            title="Export filtered student results to CSV format (streaming)"
          >
            {exportingType === 'csv' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileText size={16} />
            )}
            Download CSV
          </button>

          <button
            onClick={handleExportExcel}
            disabled={exportingType !== null || loading}
            className="btn btn-primary"
            style={{ padding: '0.6rem 1.1rem', fontSize: '0.875rem' }}
            title="Export filtered student results to Microsoft Excel (.xlsx) format"
          >
            {exportingType === 'xlsx' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileSpreadsheet size={16} />
            )}
            Download Excel (.xlsx)
          </button>
        </div>
      </div>

      {/* Live Background Export Progress Banner */}
      {exportProgress && (
        <div
          style={{
            background: '#F0FDF4',
            border: '1.5px solid #86EFAC',
            borderRadius: 'var(--radius-md)',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            boxShadow: 'var(--shadow-sm)',
            animation: 'fadeIn 0.3s ease'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              {exportProgress.status === 'COMPLETED' ? (
                <CheckCircle2 size={18} color="#059669" />
              ) : (
                <Loader2 size={18} className="animate-spin" color="#059669" />
              )}
              <span style={{ fontWeight: 700, color: '#166534', fontSize: '0.92rem' }}>
                {exportProgress.status === 'COMPLETED'
                  ? `✓ Export Completed (${exportProgress.format?.toUpperCase()})`
                  : `Generating ${exportProgress.format?.toUpperCase()} Export...`}
              </span>
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#166534' }}>
              {exportProgress.processedRecords !== undefined && exportProgress.totalRecords
                ? `${exportProgress.processedRecords.toLocaleString()} / ${exportProgress.totalRecords.toLocaleString()} records • `
                : ''}
              {exportProgress.progressPercentage || 0}%
            </div>
          </div>

          <div
            style={{
              width: '100%',
              height: '8px',
              background: '#DCFCE7',
              borderRadius: '999px',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${exportProgress.progressPercentage || 0}%`,
                height: '100%',
                background: '#059669',
                borderRadius: '999px',
                transition: 'width 0.4s ease'
              }}
            />
          </div>
        </div>
      )}

      {/* Filter Toolbar Panel */}
      <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <form onSubmit={handleApplyFilters}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: '#0F172A', fontWeight: 700, fontSize: '0.92rem' }}>
            <Filter size={16} color="var(--primary)" />
            Filter Results
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.85rem',
              marginBottom: '1rem'
            }}
          >
            {/* Search Input */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Search Student
              </label>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }} />
                <input
                  type="text"
                  placeholder="Name, Email, Roll..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem 0.55rem 2.2rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    background: '#FFFFFF',
                    fontSize: '0.85rem'
                  }}
                />
              </div>
            </div>

            {/* Exam Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Exam
              </label>
              <select
                value={examFilter}
                onChange={(e) => setExamFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: '#FFFFFF',
                  fontSize: '0.85rem'
                }}
              >
                <option value="ALL">All Exams</option>
                {exams.map((ex) => (
                  <option key={ex._id} value={ex._id}>
                    {ex.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Academic Year Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Academic Year
              </label>
              <select
                value={academicYearFilter}
                onChange={(e) => setAcademicYearFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: '#FFFFFF',
                  fontSize: '0.85rem'
                }}
              >
                <option value="ALL">All Academic Years</option>
                {academicYears.map((ay) => (
                  <option key={ay._id} value={ay._id}>
                    {ay.name} ({ay.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Branch Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Branch
              </label>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: '#FFFFFF',
                  fontSize: '0.85rem'
                }}
              >
                <option value="ALL">All Branches</option>
                {branches.map((b) => (
                  <option key={b._id} value={b.code}>
                    {b.code} - {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Semester Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Semester
              </label>
              <select
                value={semesterFilter}
                onChange={(e) => setSemesterFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: '#FFFFFF',
                  fontSize: '0.85rem'
                }}
              >
                <option value="ALL">All Semesters</option>
                {semesters.map((s) => (
                  <option key={s._id} value={String(s.number)}>
                    Semester {s.number}
                  </option>
                ))}
              </select>
            </div>

            {/* Section Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Section
              </label>
              <select
                value={sectionFilter}
                onChange={(e) => setSectionFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: '#FFFFFF',
                  fontSize: '0.85rem'
                }}
              >
                <option value="ALL">All Sections</option>
                {sections.map((sec) => (
                  <option key={sec._id} value={sec.name}>
                    Section {sec.name} {sec.branch?.code ? `(${sec.branch.code})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Batch Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Batch
              </label>
              <select
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: '#FFFFFF',
                  fontSize: '0.85rem'
                }}
              >
                <option value="ALL">All Batches</option>
                {batches.map((bat) => (
                  <option key={bat._id} value={bat.name}>
                    {bat.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Subject Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Subject
              </label>
              <select
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: '#FFFFFF',
                  fontSize: '0.85rem'
                }}
              >
                <option value="ALL">All Subjects</option>
                {subjects.map((sub) => (
                  <option key={sub._id} value={sub._id}>
                    {sub.subjectCode} - {sub.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Result Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: '#FFFFFF',
                  fontSize: '0.85rem'
                }}
              >
                <option value="ALL">All Statuses</option>
                <option value="PASSED">Passed Only</option>
                <option value="FAILED">Failed Only</option>
              </select>
            </div>

            {/* Date Range Start */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                From Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: '#FFFFFF',
                  fontSize: '0.85rem'
                }}
              />
            </div>

            {/* Date Range End */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                To Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: '#FFFFFF',
                  fontSize: '0.85rem'
                }}
              />
            </div>
          </div>

          {/* Filter Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
            <button
              type="button"
              onClick={handleResetFilters}
              className="btn btn-secondary btn-sm"
              style={{ padding: '0.45rem 0.9rem' }}
            >
              <RefreshCw size={14} />
              Reset Filters
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              style={{ padding: '0.45rem 1.1rem' }}
            >
              <Filter size={14} />
              Apply Filters
            </button>
          </div>
        </form>
      </div>

      {/* Results Count & Submissions Table */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        {/* Header summary inside table box */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>
              Showing {results.length} results
            </span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
              (Total matching: <strong>{totalCount}</strong>)
            </span>
          </div>

          {/* Page size limit */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            <span>Per page:</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              style={{
                padding: '0.25rem 0.5rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                fontSize: '0.85rem'
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem' }}>
            <Loader2 size={32} className="animate-spin" color="var(--primary)" />
            <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading filtered exam results...</p>
          </div>
        ) : results.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3.5rem 1rem' }}>
            <Award size={42} color="var(--text-subtle)" style={{ marginBottom: '0.75rem', opacity: 0.6 }} />
            <h3 style={{ fontSize: '1.1rem', color: '#0F172A', marginBottom: '0.35rem' }}>No Exam Results Found</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', maxWidth: '400px', margin: '0 auto 1.25rem' }}>
              No student submissions match your current filter parameters. Try adjusting or resetting your filters.
            </p>
            <button onClick={handleResetFilters} className="btn btn-secondary btn-sm">
              <RefreshCw size={14} />
              Reset All Filters
            </button>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student Info</th>
                  <th>Roll / Enroll No.</th>
                  <th>Academic Info</th>
                  <th>Exam Title</th>
                  <th>Subject</th>
                  <th>Marks</th>
                  <th>Percentage</th>
                  <th>Status</th>
                  <th>Submitted At</th>
                  <th>Verification ID</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {results.map((res) => {
                  const studentName = res.studentName || res.studentId?.name || 'Unknown Student';
                  const studentEmail = res.email || res.studentId?.email || '';
                  const rollNo = res.rollNumber || res.studentId?.rollNumber || '-';
                  const enrollNo = res.enrollmentNumber || res.studentId?.enrollmentNumber || '-';
                  const branch = res.branch || res.studentId?.branch || '-';
                  const sem = res.semester || res.studentId?.semester || '-';
                  const sec = res.section || res.studentId?.section || '-';
                  const examTitle = res.examName || res.examId?.title || 'Exam deleted';
                  const subjectName = res.subjectName || res.examId?.subjectId?.name || '-';
                  const subjectCode = res.subjectCode || res.examId?.subjectCode || '';
                  const score = res.marks !== undefined ? res.marks : (res.score !== undefined ? res.score : 0);
                  const total = res.maximumMarks !== undefined ? res.maximumMarks : (res.totalMarks || res.examId?.totalMarks || 0);
                  const isPassed = res.isPassed !== undefined ? res.isPassed : (score >= (res.examId?.passMarks || 0));
                  const percentage = res.percentage || (total > 0 ? `${((score / total) * 100).toFixed(2)}%` : '0%');
                  const verificationId = res.verificationId || '-';
                  const submittedAtStr = res.submittedAt ? (res.submittedAt.includes('T') ? new Date(res.submittedAt).toLocaleString() : res.submittedAt) : '-';

                  return (
                    <tr key={res._id}>
                      {/* Student Info */}
                      <td style={{ fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap' }}>
                        {studentName}
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{studentEmail}</div>
                      </td>

                      {/* Roll & Enrollment */}
                      <td style={{ fontSize: '0.825rem', whiteSpace: 'nowrap' }}>
                        <div><strong>Roll:</strong> {rollNo}</div>
                        {enrollNo !== '-' && <div style={{ color: 'var(--text-subtle)', fontSize: '0.76rem' }}>Enr: {enrollNo}</div>}
                      </td>

                      {/* Academic Info */}
                      <td style={{ fontSize: '0.825rem', whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 600, color: '#0F172A' }}>{branch}</span>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                          Sem {sem} {sec !== '-' ? `• Sec ${sec}` : ''}
                        </div>
                      </td>

                      {/* Exam Title */}
                      <td style={{ color: '#0F172A', minWidth: '160px', fontWeight: 500 }}>
                        {examTitle}
                      </td>

                      {/* Subject */}
                      <td style={{ fontSize: '0.825rem', color: 'var(--text-muted)', minWidth: '130px' }}>
                        {subjectName}
                        {subjectCode && <div style={{ fontSize: '0.74rem', color: 'var(--text-subtle)' }}>({subjectCode})</div>}
                      </td>

                      {/* Score */}
                      <td style={{ fontWeight: 700, color: 'var(--accent-purple)', whiteSpace: 'nowrap' }}>
                        {score} / {total}
                      </td>

                      {/* Percentage */}
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {percentage}
                      </td>

                      {/* Status */}
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className={`badge ${isPassed ? 'badge-passed' : 'badge-failed'}`}>
                          {isPassed ? 'Passed' : 'Failed'}
                        </span>
                      </td>

                      {/* Submitted At */}
                      <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                        {submittedAtStr}
                      </td>

                      {/* Verification ID */}
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.78rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        {verificationId}
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => handleDownloadPdf(res)}
                            disabled={downloadingId === res._id}
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.35rem 0.65rem' }}
                            title="Download Official PDF Report"
                          >
                            {downloadingId === res._id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Download size={13} />
                            )}
                            PDF
                          </button>
                          <button
                            onClick={() => openResultDetail(res._id)}
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.35rem 0.65rem' }}
                            title="View Question-by-Question Breakdown"
                          >
                            <Eye size={13} />
                            Details
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '1.5rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border-color)',
              flexWrap: 'wrap',
              gap: '0.75rem'
            }}
          >
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Page <strong>{page}</strong> of <strong>{totalPages}</strong> (Total <strong>{totalCount}</strong> results)
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="btn btn-secondary btn-sm"
                style={{ padding: '0.4rem 0.8rem' }}
              >
                <ChevronLeft size={15} />
                Previous
              </button>

              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum = i + 1;
                  if (totalPages > 5) {
                    if (page <= 3) pageNum = i + 1;
                    else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
                    else pageNum = page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      disabled={loading}
                      style={{
                        padding: '0.35rem 0.7rem',
                        borderRadius: 'var(--radius-sm)',
                        border: `1px solid ${page === pageNum ? 'var(--primary)' : 'var(--border-color)'}`,
                        background: page === pageNum ? 'var(--primary)' : '#FFFFFF',
                        color: page === pageNum ? '#FFFFFF' : 'var(--text-main)',
                        fontWeight: page === pageNum ? 700 : 500,
                        fontSize: '0.85rem',
                        cursor: 'pointer'
                      }}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="btn btn-secondary btn-sm"
                style={{ padding: '0.4rem 0.8rem' }}
              >
                Next
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Export History Modal */}
      {historyModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '850px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <History size={20} color="var(--primary)" />
                <div>
                  <h3 style={{ fontSize: '1.2rem', color: '#0F172A', margin: 0 }}>Export History & Downloads</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
                    Past large export jobs, status, and direct file downloads (Retained for 7 days)
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  onClick={() => fetchExportHistory(historyPage)}
                  disabled={historyLoading}
                  className="btn btn-secondary btn-sm"
                  title="Refresh Export History"
                >
                  <RefreshCw size={14} className={historyLoading ? 'animate-spin' : ''} />
                  Refresh
                </button>
                <button onClick={() => setHistoryModalOpen(false)} className="btn btn-secondary btn-sm">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="modal-body" style={{ padding: '1.25rem 0' }}>
              {historyLoading ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                  <Loader2 size={30} className="animate-spin" color="var(--primary)" />
                  <p style={{ marginTop: '0.6rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading export history...</p>
                </div>
              ) : exportHistoryList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                  <HardDrive size={36} color="var(--text-subtle)" style={{ marginBottom: '0.6rem', opacity: 0.5 }} />
                  <h4 style={{ fontSize: '1rem', color: '#0F172A', marginBottom: '0.25rem' }}>No Previous Exports Found</h4>
                  <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', maxWidth: '350px', margin: '0 auto' }}>
                    When you run CSV or Excel exports, they will appear here for 7 days so you can download them at any time.
                  </p>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>File Name & Format</th>
                        <th>Created By</th>
                        <th>Total Records</th>
                        <th>File Size</th>
                        <th>Status</th>
                        <th>Created At</th>
                        <th style={{ textAlign: 'right' }}>Download</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exportHistoryList.map((job) => {
                        const isCompleted = job.status === 'COMPLETED';
                        const isProcessing = job.status === 'PROCESSING' || job.status === 'QUEUED';
                        const isFailed = job.status === 'FAILED';
                        const isExpired = job.status === 'EXPIRED';

                        const fileSizeStr = job.fileSize
                          ? (job.fileSize > 1024 * 1024
                              ? `${(job.fileSize / (1024 * 1024)).toFixed(2)} MB`
                              : `${(job.fileSize / 1024).toFixed(1)} KB`)
                          : '-';

                        const dateStr = job.createdAt
                          ? new Date(job.createdAt).toLocaleString()
                          : '-';

                        return (
                          <tr key={job.jobId || job._id}>
                            <td style={{ fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                {job.format === 'xlsx' ? (
                                  <FileSpreadsheet size={16} color="#059669" />
                                ) : (
                                  <FileText size={16} color="#0284C7" />
                                )}
                                <span>{job.fileName || `Results_${job.jobId}`}</span>
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                ID: {job.jobId}
                              </div>
                            </td>

                            <td style={{ fontSize: '0.825rem', whiteSpace: 'nowrap' }}>
                              {job.createdBy?.name || 'Admin'}
                            </td>

                            <td style={{ fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              {job.totalRecords ? job.totalRecords.toLocaleString() : 0} rows
                            </td>

                            <td style={{ fontSize: '0.825rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {fileSizeStr}
                            </td>

                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.3rem',
                                  padding: '0.2rem 0.55rem',
                                  borderRadius: '999px',
                                  fontSize: '0.74rem',
                                  fontWeight: 700,
                                  background: isCompleted ? '#DCFCE7' : isProcessing ? '#FEF3C7' : isExpired ? '#F1F5F9' : '#FEE2E2',
                                  color: isCompleted ? '#166534' : isProcessing ? '#92400E' : isExpired ? '#64748B' : '#991B1B',
                                  border: `1px solid ${isCompleted ? '#86EFAC' : isProcessing ? '#FCD34D' : isExpired ? '#CBD5E1' : '#FECDD3'}`
                                }}
                              >
                                {isProcessing && <Loader2 size={11} className="animate-spin" />}
                                {job.status}
                                {isProcessing && ` (${job.progressPercentage || 0}%)`}
                              </span>
                            </td>

                            <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {dateStr}
                            </td>

                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {isCompleted ? (
                                <button
                                  onClick={() => handleDownloadHistoryJob(job)}
                                  disabled={historyDownloadingJobId === job.jobId}
                                  className="btn btn-primary btn-sm"
                                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                                >
                                  {historyDownloadingJobId === job.jobId ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : (
                                    <Download size={13} />
                                  )}
                                  Download
                                </button>
                              ) : isFailed ? (
                                <span style={{ fontSize: '0.76rem', color: '#991B1B' }} title={job.errorMessage}>
                                  Failed
                                </span>
                              ) : isExpired ? (
                                <span style={{ fontSize: '0.76rem', color: '#64748B' }}>
                                  Expired
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.76rem', color: '#92400E' }}>
                                  Queued...
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* History Pagination */}
              {historyTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Page {historyPage} of {historyTotalPages}
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      onClick={() => fetchExportHistory(historyPage - 1)}
                      disabled={historyPage <= 1 || historyLoading}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }}
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => fetchExportHistory(historyPage + 1)}
                      disabled={historyPage >= historyTotalPages || historyLoading}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Result Detail Breakdown Modal */}
      {(selectedResult || modalLoading) && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '820px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', color: '#0F172A', marginBottom: '0.2rem' }}>Detailed Answer Breakdown</h3>
                {selectedResult && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Student: <strong>{selectedResult.studentId?.name}</strong> • Exam: <strong>{selectedResult.examId?.title}</strong>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {selectedResult && (
                  <button
                    onClick={() => handleDownloadPdf(selectedResult)}
                    disabled={downloadingId === selectedResult._id}
                    className="btn btn-primary btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    {downloadingId === selectedResult._id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    Download PDF
                  </button>
                )}
                <button onClick={() => setSelectedResult(null)} className="btn btn-secondary btn-sm">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="modal-body" style={{ padding: '1.25rem 0' }}>
              {modalLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <Loader2 size={28} className="animate-spin" color="var(--primary)" />
                  <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>Loading result breakdown...</p>
                </div>
              ) : selectedResult ? (
                <div>
                  {/* Summary Metric Cards */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: '0.85rem',
                      marginBottom: '1.5rem',
                      background: '#F8FAFC',
                      padding: '1rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)'
                    }}
                  >
                    <div>
                      <span style={{ fontSize: '0.76rem', color: 'var(--text-subtle)', fontWeight: 600 }}>Score</span>
                      <h4 style={{ fontSize: '1.25rem', color: 'var(--accent-purple)' }}>
                        {selectedResult.score} / {selectedResult.totalMarks}
                      </h4>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.76rem', color: 'var(--text-subtle)', fontWeight: 600 }}>Percentage</span>
                      <h4 style={{ fontSize: '1.25rem', color: '#0F172A' }}>
                        {selectedResult.percentage}%
                      </h4>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.76rem', color: 'var(--text-subtle)', fontWeight: 600 }}>Correct / Wrong</span>
                      <h4 style={{ fontSize: '1.25rem', color: '#059669' }}>
                        {selectedResult.correctAnswers} / {selectedResult.wrongAnswers}
                      </h4>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.76rem', color: 'var(--text-subtle)', fontWeight: 600 }}>Verification ID</span>
                      <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: '0.3rem' }}>
                        {selectedResult.verificationId || '-'}
                      </h4>
                    </div>
                  </div>

                  {selectedResult.negativeMarksDeducted > 0 && (
                    <div
                      style={{
                        marginTop: '-0.75rem',
                        marginBottom: '1.25rem',
                        padding: '0.55rem 0.9rem',
                        background: 'rgba(244, 63, 94, 0.1)',
                        border: '1px solid rgba(244, 63, 94, 0.25)',
                        borderRadius: 'var(--radius-sm)',
                        color: '#E11D48',
                        fontSize: '0.825rem'
                      }}
                    >
                      ⚠️ Negative marking deduction applied: <strong>-{selectedResult.negativeMarksDeducted} marks</strong>
                    </div>
                  )}

                  {/* Question breakdown list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {selectedResult.answers?.map((ans, idx) => {
                      const isSubj = ans.questionType === 'SUBJECTIVE';
                      const qMarks = ans.totalQuestionMarks || ans.maximumMarks || 1;
                      const awarded = ans.marksObtained != null ? ans.marksObtained : (ans.awardedMarks || 0);

                      if (isSubj) {
                        return (
                          <div
                            key={idx}
                            style={{
                              padding: '1.25rem',
                              borderRadius: '10px',
                              background: '#FFFFFF',
                              border: ans.evaluationStatus === 'MANUAL_REVIEW_REQUIRED'
                                ? '1.5px solid #FCD34D'
                                : '1px solid var(--border-color)',
                              boxShadow: 'var(--shadow-card)'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                                <Sparkles size={20} color="#D97706" style={{ flexShrink: 0, marginTop: '2px' }} />
                                <div>
                                  <strong style={{ fontSize: '0.95rem', color: '#0F172A' }}>
                                    Q{idx + 1}. {ans.questionText}
                                  </strong>
                                  <span style={{
                                    fontSize: '0.72rem',
                                    marginLeft: '0.5rem',
                                    padding: '0.15rem 0.5rem',
                                    borderRadius: '4px',
                                    background: '#FEF3C7',
                                    color: '#92400E',
                                    fontWeight: 700,
                                    border: '1px solid #FCD34D'
                                  }}>
                                    SUBJECTIVE (AI EVAL)
                                  </span>
                                </div>
                              </div>

                              <span style={{
                                fontSize: '0.85rem',
                                fontWeight: 700,
                                color: awarded > 0 ? '#166534' : '#991B1B',
                                background: awarded > 0 ? '#DCFCE7' : '#FEE2E2',
                                border: awarded > 0 ? '1px solid #86EFAC' : '1px solid #FECDD3',
                                padding: '0.2rem 0.6rem',
                                borderRadius: '6px'
                              }}>
                                {awarded} / {qMarks} pts
                              </span>
                            </div>

                            {/* Student Answer */}
                            <div style={{
                              background: '#F8FAFC',
                              padding: '0.85rem',
                              borderRadius: '8px',
                              border: '1px solid #E2E8F0',
                              marginBottom: '0.75rem',
                              fontSize: '0.875rem'
                            }}>
                              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', marginBottom: '0.25rem' }}>
                                Candidate's Written Response:
                              </div>
                              <div style={{ color: '#0F172A', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                {ans.answerText || ans.selectedAnswer || '[No Answer Provided]'}
                              </div>
                            </div>

                            {/* Reference Model Answer */}
                            {ans.expectedAnswer && (
                              <div style={{
                                background: '#F0FDF4',
                                padding: '0.75rem 0.85rem',
                                borderRadius: '8px',
                                border: '1px solid #BBF7D0',
                                marginBottom: '0.75rem',
                                fontSize: '0.825rem'
                              }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#166534', marginBottom: '0.2rem' }}>
                                  Expected Model Answer:
                                </div>
                                <div style={{ color: '#14532D', lineHeight: 1.4 }}>
                                  {ans.expectedAnswer}
                                </div>
                              </div>
                            )}

                            {/* Keyword & Concept Matching Badges */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginBottom: '0.75rem' }}>
                              <div style={{ background: '#F8FAFC', padding: '0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.78rem' }}>
                                <div style={{ fontWeight: 700, color: '#0369A1', marginBottom: '0.3rem' }}>
                                  Matched Keywords:
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                                  {ans.matchedKeywords?.length > 0 ? (
                                    ans.matchedKeywords.map((kw, ki) => (
                                      <span key={ki} style={{ background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC', padding: '0.1rem 0.4rem', borderRadius: '3px' }}>
                                        ✓ {kw}
                                      </span>
                                    ))
                                  ) : (
                                    <span style={{ color: '#94A3B8' }}>None detected</span>
                                  )}
                                  {ans.missingKeywords?.map((kw, ki) => (
                                    <span key={ki} style={{ background: '#FEE2E2', color: '#991B1B', border: '1px solid #FECDD3', padding: '0.1rem 0.4rem', borderRadius: '3px' }}>
                                      ✗ {kw}
                                    </span>
                                  ))}
                                </div>
                              </div>

                              <div style={{ background: '#F8FAFC', padding: '0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.78rem' }}>
                                <div style={{ fontWeight: 700, color: '#065F46', marginBottom: '0.3rem' }}>
                                  Matched Concepts:
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                                  {ans.matchedConcepts?.length > 0 ? (
                                    ans.matchedConcepts.map((c, ci) => (
                                      <span key={ci} style={{ background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC', padding: '0.1rem 0.4rem', borderRadius: '3px' }}>
                                        ✓ {c}
                                      </span>
                                    ))
                                  ) : (
                                    <span style={{ color: '#94A3B8' }}>None detected</span>
                                  )}
                                  {ans.missingConcepts?.map((c, ci) => (
                                    <span key={ci} style={{ background: '#FEE2E2', color: '#991B1B', border: '1px solid #FECDD3', padding: '0.1rem 0.4rem', borderRadius: '3px' }}>
                                      ✗ {c}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {/* Contradiction / False Claims Banner */}
                            {ans.incorrectClaims?.length > 0 && (
                              <div style={{
                                background: '#FFF1F2',
                                border: '1px solid #FECDD3',
                                color: '#BE123C',
                                padding: '0.5rem 0.75rem',
                                borderRadius: '6px',
                                fontSize: '0.8rem',
                                marginBottom: '0.75rem'
                              }}>
                                <strong>⚠️ Factual Contradiction Detected:</strong>
                                <ul style={{ margin: '0.2rem 0 0 1.2rem', padding: 0 }}>
                                  {ans.incorrectClaims.map((claim, ci) => (
                                    <li key={ci}>{claim}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Score Metrics Grid */}
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(5, 1fr)',
                              gap: '0.5rem',
                              background: '#F1F5F9',
                              padding: '0.65rem',
                              borderRadius: '6px',
                              textAlign: 'center',
                              fontSize: '0.75rem',
                              marginBottom: '0.75rem'
                            }}>
                              <div>
                                <span style={{ color: '#64748B' }}>Correctness</span>
                                <div style={{ fontWeight: 800, color: '#0F172A', fontSize: '0.9rem' }}>{ans.evaluationScore || 0}%</div>
                              </div>
                              <div>
                                <span style={{ color: '#64748B' }}>Confidence</span>
                                <div style={{ fontWeight: 800, color: '#0369A1', fontSize: '0.9rem' }}>{ans.confidenceScore || 0}%</div>
                              </div>
                              <div>
                                <span style={{ color: '#64748B' }}>Keyword Cov.</span>
                                <div style={{ fontWeight: 800, color: '#059669', fontSize: '0.9rem' }}>{ans.keywordScore || 0}%</div>
                              </div>
                              <div>
                                <span style={{ color: '#64748B' }}>Concept Cov.</span>
                                <div style={{ fontWeight: 800, color: '#059669', fontSize: '0.9rem' }}>{ans.conceptScore || 0}%</div>
                              </div>
                              <div>
                                <span style={{ color: '#64748B' }}>Semantic Sim.</span>
                                <div style={{ fontWeight: 800, color: '#7C3AED', fontSize: '0.9rem' }}>{ans.semanticScore || 0}%</div>
                              </div>
                            </div>

                            {/* AI Reason & Justification */}
                            {ans.evaluationReason && (
                              <div style={{ fontSize: '0.8rem', color: '#475569', fontStyle: 'italic', marginBottom: '0.75rem' }}>
                                <strong>Evaluation Justification:</strong> {ans.evaluationReason}
                              </div>
                            )}

                            {/* Instructor Mark Override Controls */}
                            <div style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              background: '#F8FAFC',
                              border: '1px dashed #CBD5E1',
                              padding: '0.65rem 0.85rem',
                              borderRadius: '6px',
                              flexWrap: 'wrap',
                              gap: '0.5rem'
                            }}>
                              <div style={{ fontSize: '0.8rem', color: '#334155' }}>
                                Suggested: <strong>{ans.originalAiSuggestedMarks ?? ans.awardedMarks} / {qMarks} pts</strong>
                                {ans.evaluationStatus === 'TEACHER_OVERRIDDEN' && (
                                  <span style={{ marginLeft: '0.5rem', color: '#166534', fontWeight: 600 }}>
                                    (Teacher Overridden: {ans.overrideReason || 'Reviewed'})
                                  </span>
                                )}
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const newMarks = prompt(`Enter awarded marks for Q${idx + 1} (0 to ${qMarks}):`, String(ans.originalAiSuggestedMarks ?? awarded));
                                    if (newMarks === null) return;
                                    const num = Number(newMarks);
                                    if (isNaN(num) || num < 0 || num > qMarks) {
                                      alert(`Please enter a valid number between 0 and ${qMarks}`);
                                      return;
                                    }
                                    const reason = prompt('Optional reason for mark override:', 'Instructor manual review override') || '';
                                    try {
                                      await resultService.overrideSubjectiveAnswer(selectedResult._id, {
                                        questionId: ans.questionId,
                                        marksAwarded: num,
                                        overrideReason: reason
                                      });
                                      showToast('Subjective marks updated successfully!');
                                      openResultDetail(selectedResult._id);
                                      fetchResults();
                                    } catch (err) {
                                      alert(err.message || 'Failed to override marks');
                                    }
                                  }}
                                  className="btn btn-primary btn-sm"
                                  style={{ padding: '0.25rem 0.65rem', fontSize: '0.75rem', gap: '0.35rem' }}
                                >
                                  <Edit size={12} /> Override / Edit Marks
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Objective (SINGLE / MULTIPLE)
                      return (
                        <div
                          key={idx}
                          style={{
                            padding: '1rem',
                            borderRadius: 'var(--radius-sm)',
                            background: '#FFFFFF',
                            border: '1px solid var(--border-color)',
                            boxShadow: 'var(--shadow-card)'
                          }}
                        >
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                            <div style={{ marginTop: '0.15rem' }}>
                              {ans.isCorrect ? (
                                <CheckCircle2 size={18} color="#059669" />
                              ) : ans.selectedAnswer ? (
                                <XCircle size={18} color="#E11D48" />
                              ) : (
                                <MinusCircle size={18} color="#D97706" />
                              )}
                            </div>
                            <div>
                              <strong style={{ fontSize: '0.925rem', color: '#0F172A' }}>
                                Q{idx + 1}. {ans.questionText}
                              </strong>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginLeft: '0.5rem' }}>
                                ({ans.marksObtained} / {ans.totalQuestionMarks || 1} mark)
                              </span>
                            </div>
                          </div>

                          <div style={{ fontSize: '0.85rem', marginLeft: '1.65rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>Student Answer:</span>{' '}
                              <strong style={{ color: ans.isCorrect ? '#059669' : '#E11D48' }}>
                                {ans.selectedAnswer || 'Not Answered'}
                              </strong>
                            </div>
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>Correct Answer:</span>{' '}
                              <strong style={{ color: '#059669' }}>{ans.correctAnswer}</strong>
                            </div>
                            {ans.explanation && (
                              <div style={{ marginTop: '0.35rem', color: 'var(--text-subtle)', fontSize: '0.8rem', fontStyle: 'italic', background: '#F8FAFC', padding: '0.4rem 0.6rem', borderRadius: '4px' }}>
                                Explanation: {ans.explanation}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultsList;
