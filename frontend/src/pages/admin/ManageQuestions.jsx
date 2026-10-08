import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { questionService } from '../../services/questionService';
import { examService } from '../../services/examService';
import {
  ArrowLeft,
  Plus,
  Edit,
  Trash2,
  CheckCircle2,
  HelpCircle,
  AlertCircle,
  X,
  Image as ImageIcon,
  Upload,
  Loader2,
  Link as LinkIcon,
  Eye,
  FileText,
  Sparkles,
  Sliders,
  Check,
  Play,
  Layers,
  FileCode2,
  BookOpen
} from 'lucide-react';
import { getFullImageUrl } from '../../services/api';
import PdfQuestionExtractorModal from '../../components/PdfQuestionExtractorModal';

const ManageQuestions = () => {
  const { examId } = useParams();
  const navigate = useNavigate();

  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [previewImageModal, setPreviewImageModal] = useState(null);

  // Question Form State
  const [questionText, setQuestionText] = useState('');
  const [questionType, setQuestionType] = useState('SINGLE'); // 'SINGLE' | 'MULTIPLE' | 'SUBJECTIVE'
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [correctAnswers, setCorrectAnswers] = useState([]);
  const [marks, setMarks] = useState(1);
  const [explanation, setExplanation] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageInputMode, setImageInputMode] = useState('upload'); // 'upload' | 'url'
  const [uploadingImage, setUploadingImage] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Subjective / Descriptive Form State
  const [expectedAnswer, setExpectedAnswer] = useState('');
  const [keywordsInput, setKeywordsInput] = useState('');
  const [keywordsList, setKeywordsList] = useState([]);
  const [conceptsInput, setConceptsInput] = useState('');
  const [conceptsList, setConceptsList] = useState([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [autoGrade, setAutoGrade] = useState(true);
  const [threshold, setThreshold] = useState(70);
  const [keywordWeight, setKeywordWeight] = useState(25);
  const [conceptWeight, setConceptWeight] = useState(25);
  const [semanticWeight, setSemanticWeight] = useState(30);
  const [aiWeight, setAiWeight] = useState(20);
  const [allowTeacherOverride, setAllowTeacherOverride] = useState(true);
  const [rubrics, setRubrics] = useState([]);

  // Live Test Sandbox State
  const [testAnswerInput, setTestAnswerInput] = useState('');
  const [testEvaluationResult, setTestEvaluationResult] = useState(null);
  const [testingAi, setTestingAi] = useState(false);

  const fetchExamAndQuestions = async () => {
    try {
      setLoading(true);
      const [examRes, qRes] = await Promise.all([
        examService.getExamById(examId),
        questionService.getQuestionsForExamAdmin(examId)
      ]);
      setExam(examRes.data);
      setQuestions(qRes.data);
    } catch (err) {
      console.error('Failed to load exam questions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExamAndQuestions();
  }, [examId]);

  const openAddModal = () => {
    setEditingQuestion(null);
    setQuestionText('');
    setQuestionType('SINGLE');
    setOptions(['', '', '', '']);
    setCorrectAnswer('');
    setCorrectAnswers([]);
    setMarks(1);
    setExplanation('');
    setImageUrl('');
    setImageInputMode('upload');
    setExpectedAnswer('');
    setKeywordsInput('');
    setKeywordsList([]);
    setConceptsInput('');
    setConceptsList([]);
    setAiEnabled(true);
    setAutoGrade(true);
    setThreshold(70);
    setKeywordWeight(25);
    setConceptWeight(25);
    setSemanticWeight(30);
    setAiWeight(20);
    setAllowTeacherOverride(true);
    setRubrics([]);
    setTestAnswerInput('');
    setTestEvaluationResult(null);
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (q) => {
    setEditingQuestion(q);
    setQuestionText(q.questionText || '');
    const qType = q.type || 'SINGLE';
    setQuestionType(qType);
    setOptions(Array.isArray(q.options) && q.options.length >= 2 ? q.options : ['', '', '', '']);
    setCorrectAnswer(q.correctAnswer || '');
    setCorrectAnswers(q.correctAnswers?.length ? q.correctAnswers : (q.correctAnswer ? [q.correctAnswer] : []));
    setMarks(q.marks || (qType === 'SUBJECTIVE' ? 5 : 1));
    setExplanation(q.explanation || '');
    setImageUrl(q.imageUrl || '');
    setImageInputMode(q.imageUrl?.startsWith('http') ? 'url' : 'upload');

    // Subjective fields
    setExpectedAnswer(q.expectedAnswer || '');
    setKeywordsList(Array.isArray(q.keywords) ? q.keywords : []);
    setKeywordsInput('');
    setConceptsList(Array.isArray(q.keyConcepts) ? q.keyConcepts : []);
    setConceptsInput('');
    
    const cfg = q.evaluationConfig || {};
    setAiEnabled(cfg.enabled !== false);
    setAutoGrade(cfg.autoGrade !== false);
    setThreshold(typeof cfg.threshold === 'number' ? cfg.threshold : 70);
    setKeywordWeight(typeof cfg.keywordWeight === 'number' ? cfg.keywordWeight : 25);
    setConceptWeight(typeof cfg.conceptWeight === 'number' ? cfg.conceptWeight : 25);
    setSemanticWeight(typeof cfg.semanticWeight === 'number' ? cfg.semanticWeight : 30);
    setAiWeight(typeof cfg.aiWeight === 'number' ? cfg.aiWeight : 20);
    setAllowTeacherOverride(cfg.allowTeacherOverride !== false);
    setRubrics(Array.isArray(q.rubric) ? q.rubric : []);
    setTestAnswerInput('');
    setTestEvaluationResult(null);

    setFormError('');
    setShowModal(true);
  };

  const handleImageFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setFormError('Image size exceeds 5MB limit.');
      return;
    }

    try {
      setUploadingImage(true);
      setFormError('');
      const formData = new FormData();
      formData.append('image', file);
      const res = await questionService.uploadImage(formData);
      setImageUrl(res.imageUrl);
    } catch (err) {
      setFormError(err.message || 'Failed to upload image.');
    } finally {
      setUploadingImage(false);
    }
  };

  const toggleCorrectAnswer = (opt) => {
    if (!opt.trim()) return;
    if (correctAnswers.includes(opt)) {
      setCorrectAnswers(correctAnswers.filter(a => a !== opt));
    } else {
      setCorrectAnswers([...correctAnswers, opt]);
    }
  };

  const handleOptionChange = (index, val) => {
    const oldVal = options[index];
    const newOpts = [...options];
    newOpts[index] = val;
    setOptions(newOpts);

    if (correctAnswer === oldVal) {
      setCorrectAnswer(val);
    }
    if (correctAnswers.includes(oldVal)) {
      setCorrectAnswers(correctAnswers.map(a => a === oldVal ? val : a));
    }
  };

  const addOptionField = () => {
    setOptions([...options, '']);
  };

  const removeOptionField = (index) => {
    if (options.length <= 2) {
      alert('Question must have at least 2 options.');
      return;
    }
    const valToRemove = options[index];
    const newOpts = options.filter((_, i) => i !== index);
    setOptions(newOpts);
    if (correctAnswer === valToRemove) {
      setCorrectAnswer('');
    }
    setCorrectAnswers(correctAnswers.filter(a => a !== valToRemove));
  };

  // Keyword tags handling
  const handleAddKeyword = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const clean = keywordsInput.trim().replace(/,$/, '');
      if (clean && !keywordsList.includes(clean)) {
        setKeywordsList([...keywordsList, clean]);
        setKeywordsInput('');
      }
    }
  };

  const removeKeyword = (kw) => {
    setKeywordsList(keywordsList.filter(k => k !== kw));
  };

  // Concept tags handling
  const handleAddConcept = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const clean = conceptsInput.trim().replace(/,$/, '');
      if (clean && !conceptsList.includes(clean)) {
        setConceptsList([...conceptsList, clean]);
        setConceptsInput('');
      }
    }
  };

  const removeConcept = (c) => {
    setConceptsList(conceptsList.filter(item => item !== c));
  };

  // Rubric handling
  const addRubricRow = () => {
    setRubrics([...rubrics, { criterion: '', marks: 1, description: '' }]);
  };

  const updateRubricRow = (idx, field, val) => {
    const next = [...rubrics];
    next[idx] = { ...next[idx], [field]: val };
    setRubrics(next);
  };

  const removeRubricRow = (idx) => {
    setRubrics(rubrics.filter((_, i) => i !== idx));
  };

  // Live AI Evaluation Sandbox Test
  const handleRunTestEvaluation = async () => {
    if (!testAnswerInput.trim()) {
      alert('Please enter a sample student response to test evaluation.');
      return;
    }
    try {
      setTestingAi(true);
      setTestEvaluationResult(null);
      const res = await questionService.evaluatePreview({
        questionText,
        maxMarks: Number(marks) || 5,
        expectedAnswer,
        keywords: keywordsList,
        keyConcepts: conceptsList,
        rubric: rubrics,
        studentAnswer: testAnswerInput,
        evaluationConfig: {
          enabled: aiEnabled,
          autoGrade,
          threshold,
          keywordWeight,
          conceptWeight,
          semanticWeight,
          aiWeight,
          allowTeacherOverride
        }
      });
      setTestEvaluationResult(res.data?.data || res.data);
    } catch (err) {
      alert(err.message || 'Failed to run test evaluation');
    } finally {
      setTestingAi(false);
    }
  };

  const handleSubmitQuestion = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!questionText.trim()) {
      setFormError('Please enter question text.');
      return;
    }

    let payload = {
      questionText: questionText.trim(),
      type: questionType,
      marks: Number(marks) || 1,
      explanation: explanation.trim(),
      imageUrl: imageUrl ? imageUrl.trim() : null
    };

    if (questionType === 'SUBJECTIVE') {
      if (!expectedAnswer.trim()) {
        setFormError('Please provide the Expected Reference Answer for subjective evaluation.');
        return;
      }

      payload = {
        ...payload,
        options: [],
        expectedAnswer: expectedAnswer.trim(),
        keywords: keywordsList,
        keyConcepts: conceptsList,
        rubric: rubrics.filter(r => r.criterion && r.criterion.trim()),
        evaluationConfig: {
          enabled: aiEnabled,
          autoGrade,
          threshold: Number(threshold) || 70,
          keywordWeight: Number(keywordWeight) || 25,
          conceptWeight: Number(conceptWeight) || 25,
          semanticWeight: Number(semanticWeight) || 30,
          aiWeight: Number(aiWeight) || 20,
          allowTeacherOverride
        }
      };
    } else {
      // Objective (SINGLE / MULTIPLE)
      const validOptions = options.map(o => o.trim()).filter(Boolean);
      if (validOptions.length < 2) {
        setFormError('Please provide at least 2 non-empty options.');
        return;
      }

      if (questionType === 'SINGLE') {
        if (!correctAnswer) {
          setFormError('Please select the single correct answer.');
          return;
        }
        if (!validOptions.includes(correctAnswer)) {
          setFormError('Selected correct answer must match one of the valid options.');
          return;
        }
      } else {
        const validCorrect = correctAnswers.filter(a => validOptions.includes(a));
        if (validCorrect.length === 0) {
          setFormError('Please select at least one correct option for multi-select question.');
          return;
        }
      }

      payload = {
        ...payload,
        options: validOptions,
        correctAnswer: questionType === 'SINGLE' ? correctAnswer : (correctAnswers[0] || ''),
        correctAnswers: questionType === 'MULTIPLE' 
          ? correctAnswers.filter(a => validOptions.includes(a)) 
          : [correctAnswer]
      };
    }

    try {
      setSubmitting(true);
      if (editingQuestion) {
        await questionService.updateQuestion(editingQuestion._id, payload);
      } else {
        await questionService.addQuestion(examId, payload);
      }
      setShowModal(false);
      fetchExamAndQuestions();
    } catch (err) {
      setFormError(err.message || 'Failed to save question');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteQuestion = async (id) => {
    if (window.confirm('Are you sure you want to delete this question?')) {
      try {
        await questionService.deleteQuestion(id);
        fetchExamAndQuestions();
      } catch (err) {
        alert(err.message || 'Failed to delete question');
      }
    }
  };

  const handlePdfImportSuccess = (count) => {
    setSuccessMsg(`🎉 Successfully imported ${count} questions from PDF into this exam!`);
    fetchExamAndQuestions();
    setTimeout(() => setSuccessMsg(''), 6000);
  };

  return (
    <div className="animate-fade-in" style={{ maxWidth: '1050px', margin: '0 auto' }}>
      {/* Success Notification Banner */}
      {successMsg && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.15)',
          border: '1px solid rgba(16, 185, 129, 0.4)',
          borderRadius: '12px',
          padding: '0.85rem 1.25rem',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          color: '#34d399',
          fontWeight: 500,
          boxShadow: '0 4px 15px rgba(16, 185, 129, 0.2)'
        }}>
          <CheckCircle2 size={20} />
          <span>{successMsg}</span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <button
          onClick={() => navigate('/admin/exams')}
          className="btn btn-secondary btn-sm"
        >
          <ArrowLeft size={16} />
          Back to Exams
        </button>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={() => setShowPdfModal(true)}
            className="btn btn-secondary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              border: '1px solid rgba(2, 132, 199, 0.4)',
              background: 'rgba(2, 132, 199, 0.12)',
              color: '#38bdf8',
              boxShadow: '0 2px 10px rgba(2, 132, 199, 0.2)'
            }}
          >
            <FileText size={18} />
            Upload Question Paper (PDF)
          </button>

          <button onClick={openAddModal} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Plus size={18} />
            Add Question
          </button>
        </div>
      </div>

      {exam && (
        <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{exam.title}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Duration: {exam.duration} mins | Total Marks: <strong style={{ color: 'var(--accent-purple)' }}>{exam.totalMarks}</strong> | Total Questions: {questions.length}
            </p>
          </div>
          <span className={`badge ${exam.isPublished ? 'badge-published' : 'badge-draft'}`}>
            {exam.isPublished ? 'Published' : 'Draft'}
          </span>
        </div>
      )}

      {/* Questions List */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: '3rem 0', textAlign: 'center' }}>
          <Loader2 className="animate-spin" size={32} style={{ margin: '0 auto 1rem' }} />
          Loading Exam Questions...
        </div>
      ) : questions.length === 0 ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
          <BookOpen size={48} color="var(--text-subtle)" style={{ margin: '0 auto 1rem' }} />
          <h3>No Questions in Exam Yet</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Add MCQ, Multi-Select, or AI-evaluated Subjective questions to this exam.
          </p>
          <button onClick={openAddModal} className="btn btn-primary">
            <Plus size={16} /> Add First Question
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {questions.map((q, idx) => (
            <div key={q._id} className="glass-panel" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div style={{ flex: 1, minWidth: '260px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--accent-indigo)' }}>
                      #{idx + 1}
                    </span>
                    <h3 style={{ fontSize: '1.1rem', margin: 0, color: '#0F172A' }}>{q.questionText}</h3>
                  </div>

                  {q.imageUrl && (
                    <div style={{ marginTop: '0.65rem' }}>
                      <button
                        type="button"
                        onClick={() => setPreviewImageModal(getFullImageUrl(q.imageUrl))}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.3rem 0.65rem',
                          borderRadius: 'var(--radius-sm)',
                          background: 'rgba(79, 70, 229, 0.12)',
                          border: '1px solid rgba(79, 70, 229, 0.3)',
                          color: 'var(--accent-purple)',
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          fontWeight: 500
                        }}
                      >
                        <img
                          src={getFullImageUrl(q.imageUrl)}
                          alt="Question Diagram"
                          style={{
                            width: '32px',
                            height: '24px',
                            objectFit: 'cover',
                            borderRadius: '3px'
                          }}
                        />
                        <span>View Diagram</span>
                        <Eye size={12} />
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {q.type === 'SUBJECTIVE' ? (
                    <span style={{
                      fontSize: '0.75rem',
                      padding: '0.25rem 0.65rem',
                      borderRadius: '6px',
                      background: '#FEF3C7',
                      border: '1px solid #FCD34D',
                      color: '#92400E',
                      fontWeight: 800,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}>
                      <Sparkles size={12} color="#D97706" />
                      SUBJECTIVE (AI EVAL)
                    </span>
                  ) : q.type === 'MULTIPLE' ? (
                    <span style={{
                      fontSize: '0.75rem',
                      padding: '0.25rem 0.65rem',
                      borderRadius: '6px',
                      background: '#F3E8FF',
                      border: '1px solid #D8B4FE',
                      color: '#7E22CE',
                      fontWeight: 700
                    }}>
                      Multi-Select (MSQ)
                    </span>
                  ) : (
                    <span style={{
                      fontSize: '0.75rem',
                      padding: '0.25rem 0.65rem',
                      borderRadius: '6px',
                      background: '#E0F2FE',
                      border: '1px solid #BAE6FD',
                      color: '#0369A1',
                      fontWeight: 700
                    }}>
                      Single Choice (MCQ)
                    </span>
                  )}

                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
                    {q.marks} {q.marks === 1 ? 'mark' : 'marks'}
                  </span>
                  <button onClick={() => openEditModal(q)} className="btn btn-secondary btn-sm" title="Edit Question">
                    <Edit size={14} />
                  </button>
                  <button onClick={() => handleDeleteQuestion(q._id)} className="btn btn-secondary btn-sm" style={{ color: 'var(--accent-rose)' }} title="Delete Question">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Subjective Reference Preview vs MCQ Options Grid */}
              {q.type === 'SUBJECTIVE' ? (
                <div style={{
                  marginTop: '1rem',
                  padding: '0.85rem 1.1rem',
                  borderRadius: '10px',
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  fontSize: '0.875rem'
                }}>
                  <div style={{ color: '#0F172A', marginBottom: '0.4rem' }}>
                    <strong style={{ color: '#0369A1' }}>Expected Model Answer:</strong> {q.expectedAnswer || 'N/A'}
                  </div>

                  {Array.isArray(q.keywords) && q.keywords.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B' }}>Keywords:</span>
                      {q.keywords.map((kw, kIdx) => (
                        <span key={kIdx} style={{
                          fontSize: '0.72rem',
                          background: '#E0F2FE',
                          color: '#0369A1',
                          border: '1px solid #BAE6FD',
                          padding: '0.1rem 0.45rem',
                          borderRadius: '4px'
                        }}>
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}

                  {Array.isArray(q.keyConcepts) && q.keyConcepts.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B' }}>Key Concepts:</span>
                      {q.keyConcepts.map((c, cIdx) => (
                        <span key={cIdx} style={{
                          fontSize: '0.72rem',
                          background: '#ECFDF5',
                          color: '#065F46',
                          border: '1px solid #A7F3D0',
                          padding: '0.1rem 0.45rem',
                          borderRadius: '4px'
                        }}>
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.65rem', marginTop: '0.85rem' }}>
                  {q.options?.map((opt, oIdx) => {
                    const isCorrect = q.type === 'MULTIPLE'
                      ? (q.correctAnswers && q.correctAnswers.includes(opt))
                      : (opt === q.correctAnswer);
                    return (
                      <div
                        key={oIdx}
                        style={{
                          padding: '0.6rem 0.85rem',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.875rem',
                          background: isCorrect ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255,255,255,0.03)',
                          border: isCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-color)',
                          color: isCorrect ? '#34d399' : 'var(--text-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}
                      >
                        {isCorrect ? <CheckCircle2 size={16} /> : <div style={{ width: '16px' }} />}
                        <span>{opt}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {q.explanation && (
                <div style={{ marginTop: '0.75rem', fontSize: '0.825rem', color: 'var(--text-subtle)', fontStyle: 'italic' }}>
                  <strong>Explanation / Notes:</strong> {q.explanation}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Question Modal */}
      {showModal && (
        <div className="modal-overlay" style={{ overflowY: 'auto' }}>
          <div className="modal-content" style={{ maxWidth: '780px', margin: '2rem auto' }}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.25rem', margin: 0 }}>{editingQuestion ? 'Edit Question' : 'Add New Question'}</h3>
              <button onClick={() => setShowModal(false)} className="btn btn-secondary btn-sm">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitQuestion}>
              <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
                {formError && (
                  <div style={{
                    background: 'rgba(244, 63, 94, 0.15)',
                    border: '1px solid rgba(244, 63, 94, 0.3)',
                    color: '#fb7185',
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '1rem'
                  }}>
                    <AlertCircle size={16} />
                    <span>{formError}</span>
                  </div>
                )}

                {/* Question Type Selector */}
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 700 }}>Question Type / Assessment Format</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.65rem', marginTop: '0.35rem' }}>
                    <div
                      onClick={() => setQuestionType('SINGLE')}
                      style={{
                        padding: '0.75rem 0.6rem',
                        borderRadius: 'var(--radius-md)',
                        border: questionType === 'SINGLE' ? '2px solid #2563EB' : '1px solid var(--border-color)',
                        background: questionType === 'SINGLE' ? 'rgba(37, 99, 235, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                      }}
                    >
                      <input
                        type="radio"
                        name="questionTypeSelect"
                        checked={questionType === 'SINGLE'}
                        onChange={() => setQuestionType('SINGLE')}
                        style={{ accentColor: '#2563EB', cursor: 'pointer' }}
                      />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.825rem' }}>Single MCQ</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-subtle)' }}>1 choice</div>
                      </div>
                    </div>

                    <div
                      onClick={() => setQuestionType('MULTIPLE')}
                      style={{
                        padding: '0.75rem 0.6rem',
                        borderRadius: 'var(--radius-md)',
                        border: questionType === 'MULTIPLE' ? '2px solid #9333EA' : '1px solid var(--border-color)',
                        background: questionType === 'MULTIPLE' ? 'rgba(147, 51, 234, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                      }}
                    >
                      <input
                        type="radio"
                        name="questionTypeSelect"
                        checked={questionType === 'MULTIPLE'}
                        onChange={() => setQuestionType('MULTIPLE')}
                        style={{ accentColor: '#9333EA', cursor: 'pointer' }}
                      />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.825rem' }}>Multi-Select (MSQ)</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-subtle)' }}>Multiple choices</div>
                      </div>
                    </div>

                    <div
                      onClick={() => {
                        setQuestionType('SUBJECTIVE');
                        if (marks === 1) setMarks(5);
                      }}
                      style={{
                        padding: '0.75rem 0.6rem',
                        borderRadius: 'var(--radius-md)',
                        border: questionType === 'SUBJECTIVE' ? '2px solid #D97706' : '1px solid var(--border-color)',
                        background: questionType === 'SUBJECTIVE' ? 'rgba(217, 119, 6, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                      }}
                    >
                      <input
                        type="radio"
                        name="questionTypeSelect"
                        checked={questionType === 'SUBJECTIVE'}
                        onChange={() => {
                          setQuestionType('SUBJECTIVE');
                          if (marks === 1) setMarks(5);
                        }}
                        style={{ accentColor: '#D97706', cursor: 'pointer' }}
                      />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.825rem', color: questionType === 'SUBJECTIVE' ? '#D97706' : 'inherit' }}>
                          Subjective / AI
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-subtle)' }}>Free-form text</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Question Text */}
                <div className="form-group">
                  <label className="form-label">Question Text *</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    placeholder="Enter the question prompt..."
                    value={questionText}
                    onChange={(e) => setQuestionText(e.target.value)}
                    required
                  />
                </div>

                {/* Image Upload Box */}
                <div className="form-group" style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  padding: '0.85rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <label className="form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                      <ImageIcon size={15} color="var(--accent-purple)" />
                      Attach Diagram / Image (Optional)
                    </label>

                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button
                        type="button"
                        onClick={() => setImageInputMode('upload')}
                        className={`btn btn-sm ${imageInputMode === 'upload' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        Upload
                      </button>
                      <button
                        type="button"
                        onClick={() => setImageInputMode('url')}
                        className={`btn btn-sm ${imageInputMode === 'url' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        URL
                      </button>
                    </div>
                  </div>

                  {imageUrl ? (
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <img
                        src={getFullImageUrl(imageUrl)}
                        alt="Preview"
                        style={{ maxHeight: '140px', maxWidth: '100%', borderRadius: '4px', objectFit: 'contain' }}
                      />
                      <button
                        type="button"
                        onClick={() => setImageUrl('')}
                        style={{
                          position: 'absolute',
                          top: '6px',
                          right: '6px',
                          background: 'rgba(244, 63, 94, 0.9)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '50%',
                          width: '22px',
                          height: '22px',
                          cursor: 'pointer'
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : imageInputMode === 'upload' ? (
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageFileChange}
                      className="form-input"
                      style={{ fontSize: '0.85rem' }}
                    />
                  ) : (
                    <input
                      type="url"
                      className="form-input"
                      placeholder="https://example.com/diagram.png"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                    />
                  )}
                </div>

                {/* Marks / Points */}
                <div className="form-group">
                  <label className="form-label">Maximum Marks / Point Weight *</label>
                  <input
                    type="number"
                    className="form-input"
                    min={0.5}
                    step={0.5}
                    value={marks}
                    onChange={(e) => setMarks(e.target.value)}
                    required
                  />
                </div>

                {/* DIVERGENT UI: SUBJECTIVE FORM VS OBJECTIVE OPTIONS */}
                {questionType === 'SUBJECTIVE' ? (
                  <div style={{
                    background: '#FEFDF8',
                    border: '1.5px solid #FCD34D',
                    borderRadius: '12px',
                    padding: '1.25rem',
                    marginBottom: '1rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                      <Sparkles size={20} color="#D97706" />
                      <h4 style={{ fontSize: '1rem', color: '#92400E', margin: 0, fontWeight: 700 }}>
                        AI-Assisted Subjective Evaluation Configuration
                      </h4>
                    </div>

                    {/* Expected Model Answer */}
                    <div className="form-group">
                      <label className="form-label" style={{ color: '#78350F', fontWeight: 600 }}>
                        Expected Reference Model Answer *
                      </label>
                      <textarea
                        className="form-textarea"
                        rows={3}
                        placeholder="Provide the ideal complete answer that contains all necessary facts and explanations..."
                        value={expectedAnswer}
                        onChange={(e) => setExpectedAnswer(e.target.value)}
                        required
                        style={{ background: '#FFFFFF', borderColor: '#FDE68A', color: '#0F172A' }}
                      />
                      <span style={{ fontSize: '0.75rem', color: '#B45309' }}>
                        The AI and semantic similarity engine will evaluate candidate answers against this model answer.
                      </span>
                    </div>

                    {/* Important Keywords Tag Input */}
                    <div className="form-group">
                      <label className="form-label" style={{ color: '#78350F', fontWeight: 600 }}>
                        Important Keywords (Press Enter or Comma to Add)
                      </label>
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g. data security, backup, redundancy"
                          value={keywordsInput}
                          onChange={(e) => setKeywordsInput(e.target.value)}
                          onKeyDown={handleAddKeyword}
                          style={{ background: '#FFFFFF' }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const clean = keywordsInput.trim().replace(/,$/, '');
                            if (clean && !keywordsList.includes(clean)) {
                              setKeywordsList([...keywordsList, clean]);
                              setKeywordsInput('');
                            }
                          }}
                          className="btn btn-secondary btn-sm"
                        >
                          Add
                        </button>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                        {keywordsList.map((kw, i) => (
                          <span
                            key={i}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              background: '#E0F2FE',
                              border: '1px solid #BAE6FD',
                              color: '#0369A1',
                              padding: '0.2rem 0.55rem',
                              borderRadius: '6px',
                              fontSize: '0.8rem',
                              fontWeight: 600
                            }}
                          >
                            {kw}
                            <X size={12} style={{ cursor: 'pointer' }} onClick={() => removeKeyword(kw)} />
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Key Concepts Tag Input */}
                    <div className="form-group">
                      <label className="form-label" style={{ color: '#78350F', fontWeight: 600 }}>
                        Key Concepts / Principles (Press Enter or Comma to Add)
                      </label>
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g. Security, Redundancy reduction, Consistency"
                          value={conceptsInput}
                          onChange={(e) => setConceptsInput(e.target.value)}
                          onKeyDown={handleAddConcept}
                          style={{ background: '#FFFFFF' }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const clean = conceptsInput.trim().replace(/,$/, '');
                            if (clean && !conceptsList.includes(clean)) {
                              setConceptsList([...conceptsList, clean]);
                              setConceptsInput('');
                            }
                          }}
                          className="btn btn-secondary btn-sm"
                        >
                          Add
                        </button>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                        {conceptsList.map((c, i) => (
                          <span
                            key={i}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              background: '#ECFDF5',
                              border: '1px solid #A7F3D0',
                              color: '#065F46',
                              padding: '0.2rem 0.55rem',
                              borderRadius: '6px',
                              fontSize: '0.8rem',
                              fontWeight: 600
                            }}
                          >
                            {c}
                            <X size={12} style={{ cursor: 'pointer' }} onClick={() => removeConcept(c)} />
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Evaluation Config Toggles & Sliders */}
                    <div style={{
                      background: '#FFFFFF',
                      padding: '1rem',
                      borderRadius: '8px',
                      border: '1px solid #FDE68A',
                      marginTop: '1rem'
                    }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, color: '#0F172A' }}>
                          <input
                            type="checkbox"
                            checked={aiEnabled}
                            onChange={(e) => setAiEnabled(e.target.checked)}
                            style={{ width: '16px', height: '16px', accentColor: '#D97706' }}
                          />
                          AI Evaluation Enabled
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, color: '#0F172A' }}>
                          <input
                            type="checkbox"
                            checked={autoGrade}
                            onChange={(e) => setAutoGrade(e.target.checked)}
                            style={{ width: '16px', height: '16px', accentColor: '#D97706' }}
                          />
                          Auto-Grade on Submission
                        </label>
                      </div>

                      <div style={{ marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, color: '#0F172A' }}>
                          <span>Evaluation Acceptance Threshold:</span>
                          <strong style={{ color: '#D97706' }}>{threshold}%</strong>
                        </div>
                        <input
                          type="range"
                          min={50}
                          max={90}
                          value={threshold}
                          onChange={(e) => setThreshold(Number(e.target.value))}
                          style={{ width: '100%', accentColor: '#D97706', marginTop: '0.35rem' }}
                        />
                      </div>

                      {/* Weight Distribution Sliders */}
                      <div style={{ fontSize: '0.825rem', fontWeight: 700, color: '#64748B', marginBottom: '0.5rem' }}>
                        Scoring Weight Distribution:
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.8rem' }}>
                        <div>
                          Keyword Weight: <strong>{keywordWeight}%</strong>
                          <input
                            type="range"
                            min={0}
                            max={50}
                            value={keywordWeight}
                            onChange={(e) => setKeywordWeight(Number(e.target.value))}
                            style={{ width: '100%', accentColor: '#0369A1' }}
                          />
                        </div>
                        <div>
                          Concept Weight: <strong>{conceptWeight}%</strong>
                          <input
                            type="range"
                            min={0}
                            max={50}
                            value={conceptWeight}
                            onChange={(e) => setConceptWeight(Number(e.target.value))}
                            style={{ width: '100%', accentColor: '#059669' }}
                          />
                        </div>
                        <div>
                          Semantic Weight: <strong>{semanticWeight}%</strong>
                          <input
                            type="range"
                            min={0}
                            max={50}
                            value={semanticWeight}
                            onChange={(e) => setSemanticWeight(Number(e.target.value))}
                            style={{ width: '100%', accentColor: '#9333EA' }}
                          />
                        </div>
                        <div>
                          AI Evaluator Weight: <strong>{aiWeight}%</strong>
                          <input
                            type="range"
                            min={0}
                            max={50}
                            value={aiWeight}
                            onChange={(e) => setAiWeight(Number(e.target.value))}
                            style={{ width: '100%', accentColor: '#D97706' }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Rubric Criteria Builder */}
                    <div style={{ marginTop: '1.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#78350F' }}>
                          Optional Marking Rubric Criteria
                        </span>
                        <button type="button" onClick={addRubricRow} className="btn btn-secondary btn-sm" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}>
                          + Add Rubric Criterion
                        </button>
                      </div>

                      {rubrics.map((rub, rIdx) => (
                        <div key={rIdx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="Criterion name (e.g. Data Security)"
                            value={rub.criterion}
                            onChange={(e) => updateRubricRow(rIdx, 'criterion', e.target.value)}
                            style={{ flex: 2, background: '#FFFFFF', fontSize: '0.8rem' }}
                          />
                          <input
                            type="number"
                            className="form-input"
                            placeholder="Marks"
                            min={0.5}
                            step={0.5}
                            value={rub.marks}
                            onChange={(e) => updateRubricRow(rIdx, 'marks', Number(e.target.value))}
                            style={{ width: '80px', background: '#FFFFFF', fontSize: '0.8rem' }}
                          />
                          <input
                            type="text"
                            className="form-input"
                            placeholder="Description"
                            value={rub.description}
                            onChange={(e) => updateRubricRow(rIdx, 'description', e.target.value)}
                            style={{ flex: 3, background: '#FFFFFF', fontSize: '0.8rem' }}
                          />
                          <button
                            type="button"
                            onClick={() => removeRubricRow(rIdx)}
                            className="btn btn-secondary btn-sm"
                            style={{ color: '#E11D48' }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Live Test Evaluation Sandbox */}
                    <div style={{
                      marginTop: '1.25rem',
                      background: '#F0FDF4',
                      border: '1px solid #86EFAC',
                      borderRadius: '8px',
                      padding: '1rem'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                        <Play size={16} color="#166534" />
                        <strong style={{ fontSize: '0.875rem', color: '#166534' }}>
                          Test Evaluation Sandbox (Live Tester)
                        </strong>
                      </div>
                      <textarea
                        className="form-textarea"
                        rows={2}
                        placeholder="Type a sample candidate answer to test scoring..."
                        value={testAnswerInput}
                        onChange={(e) => setTestAnswerInput(e.target.value)}
                        style={{ background: '#FFFFFF', fontSize: '0.85rem' }}
                      />
                      <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={handleRunTestEvaluation}
                          disabled={testingAi}
                          className="btn btn-primary btn-sm"
                          style={{ background: '#166534', borderColor: '#166534', gap: '0.4rem' }}
                        >
                          {testingAi ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          {testingAi ? 'Evaluating...' : 'Run Test Evaluation'}
                        </button>
                      </div>

                      {testEvaluationResult && (
                        <div style={{
                          marginTop: '0.75rem',
                          padding: '0.75rem',
                          background: '#FFFFFF',
                          borderRadius: '6px',
                          border: '1px solid #BBF7D0',
                          fontSize: '0.825rem',
                          color: '#0F172A'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                            <span>Score: <strong style={{ color: '#16A34A', fontSize: '1rem' }}>{testEvaluationResult.evaluationScore}%</strong></span>
                            <span>Suggested Marks: <strong style={{ color: '#0369A1' }}>{testEvaluationResult.awardedMarks} / {testEvaluationResult.maximumMarks}</strong></span>
                            <span>Confidence: <strong>{testEvaluationResult.confidenceScore}%</strong></span>
                          </div>
                          <div style={{ fontSize: '0.78rem', color: '#475569', fontStyle: 'italic' }}>
                            <strong>Reason:</strong> {testEvaluationResult.evaluationReason}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* OBJECTIVE (MCQ / MSQ) OPTIONS SECTION */
                  <div className="form-group">
                    <label className="form-label">
                      Options & Correct Answer Selection *
                      {questionType === 'MULTIPLE' ? (
                        <span className="badge badge-purple" style={{ marginLeft: '0.5rem', fontSize: '0.72rem' }}>
                          Multi-Select (MSQ)
                        </span>
                      ) : (
                        <span className="badge badge-blue" style={{ marginLeft: '0.5rem', fontSize: '0.72rem' }}>
                          Single Choice (MCQ)
                        </span>
                      )}
                    </label>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', marginBottom: '0.5rem' }}>
                      {questionType === 'MULTIPLE'
                        ? 'Check all the boxes corresponding to the correct answers for this question.'
                        : 'Select the radio button next to the option that is the correct answer.'}
                    </p>

                    {options.map((opt, i) => {
                      const isChecked = questionType === 'MULTIPLE'
                        ? correctAnswers.includes(opt) && opt.trim() !== ''
                        : correctAnswer !== '' && correctAnswer === opt;

                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.5rem' }}>
                          {questionType === 'MULTIPLE' ? (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleCorrectAnswer(opt)}
                              disabled={!opt.trim()}
                              style={{ width: '18px', height: '18px', accentColor: 'var(--accent-purple)', cursor: 'pointer' }}
                              title="Check if this option is correct"
                            />
                          ) : (
                            <input
                              type="radio"
                              name="correctAnswerSelect"
                              checked={isChecked}
                              onChange={() => setCorrectAnswer(opt)}
                              disabled={!opt.trim()}
                              style={{ width: '18px', height: '18px', accentColor: 'var(--accent-emerald)', cursor: 'pointer' }}
                              title="Select as correct answer"
                            />
                          )}
                          <input
                            type="text"
                            className="form-input"
                            placeholder={`Option ${i + 1}`}
                            value={opt}
                            onChange={(e) => handleOptionChange(i, e.target.value)}
                            required
                          />
                          {options.length > 2 && (
                            <button
                              type="button"
                              onClick={() => removeOptionField(i)}
                              className="btn btn-secondary btn-sm"
                              style={{ color: 'var(--accent-rose)', padding: '0.5rem' }}
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      onClick={addOptionField}
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: '0.5rem' }}
                    >
                      + Add Option
                    </button>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Explanation / Post-Exam Notes (Optional)</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    placeholder="Provide detailed explanation or hints for post-exam candidate review..."
                    value={explanation}
                    onChange={(e) => setExplanation(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving Question...' : 'Save Question'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full Image Preview Lightbox Modal */}
      {previewImageModal && (
        <div
          className="modal-overlay"
          onClick={() => setPreviewImageModal(null)}
          style={{ zIndex: 10000, cursor: 'zoom-out' }}
        >
          <div
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewImageModal(null)}
              style={{
                position: 'absolute',
                top: '-40px',
                right: '0',
                background: 'rgba(255, 255, 255, 0.2)',
                border: 'none',
                color: '#fff',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <X size={18} />
            </button>
            <img
              src={previewImageModal}
              alt="Diagram Full Preview"
              style={{
                maxWidth: '100%',
                maxHeight: '80vh',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
                border: '1px solid var(--border-color)',
                objectFit: 'contain'
              }}
            />
          </div>
        </div>
      )}

      {/* PDF Question Paper Extractor Modal */}
      <PdfQuestionExtractorModal
        examId={examId}
        isOpen={showPdfModal}
        onClose={() => setShowPdfModal(false)}
        onImportSuccess={handlePdfImportSuccess}
      />
    </div>
  );
};

export default ManageQuestions;
