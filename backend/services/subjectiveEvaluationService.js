// /**
//  * Subjective / Descriptive Evaluation Service - GLB ExamSphere
//  * Multi-layer evaluation combining Keyword Matching, Concept Matching,
//  * Semantic Similarity, Contradiction Detection, and AI Evaluation with Safe Fallbacks.
//  */

// const aiProvider = require('./aiProvider');

// // Common synonyms and conceptual equivalents in computer science & academic exams
// const SYNONYM_MAP = {
//   'redundancy': ['duplicate', 'duplication', 'duplicate data', 'repeating data', 'copies', 'multiple copies', 'unnecessary duplicates'],
//   'data redundancy': ['duplicate data', 'data duplication', 'duplicate records', 'redundant data', 'repeating records'],
//   'security': ['protection', 'access control', 'authorization', 'confidentiality', 'privacy', 'secure access'],
//   'data security': ['data protection', 'access control', 'user permissions', 'secure storage', 'confidentiality'],
//   'consistency': ['integrity', 'uniformity', 'accuracy', 'coherent', 'valid state', 'correctness'],
//   'data consistency': ['data integrity', 'accurate data', 'uniform records', 'data validity'],
//   'sharing': ['concurrent access', 'multi-user', 'multiple users', 'collaborative', 'distributed access'],
//   'data sharing': ['multi-user access', 'shared database', 'multiple users access', 'concurrent access'],
//   'backup': ['recovery', 'restore', 'snapshot', 'disaster recovery', 'copy for safety', 'archive'],
//   'volatile': ['temporary', 'erased on power off', 'loses data', 'primary storage'],
//   'non-volatile': ['permanent', 'persistent', 'retains data', 'secondary storage'],
//   'scalability': ['scale', 'growth', 'expandable', 'handle more load', 'high capacity'],
//   'concurrency': ['parallel', 'simultaneous', 'multi-threading', 'concurrent transactions']
// };

// class SubjectiveEvaluationService {
//   constructor() {
//     this.version = 'subjective-v1';
//   }

//   /**
//    * Main evaluation entry point for a subjective answer
//    */
//   async evaluateAnswer({
//     question,
//     studentAnswer = '',
//     customInstructions = ''
//   }) {
//     const questionText = question.questionText || '';
//     const maxMarks = Math.max(0.5, Number(question.marks) || 1);
//     const expectedAnswer = question.expectedAnswer || '';
//     const keywords = Array.isArray(question.keywords) ? question.keywords : [];
//     const keyConcepts = Array.isArray(question.keyConcepts) ? question.keyConcepts : [];
//     const rubric = Array.isArray(question.rubric) ? question.rubric : [];
//     const config = question.evaluationConfig || {};

//     const isAiEnabled = config.enabled !== false;
//     const threshold = typeof config.threshold === 'number' ? config.threshold : 70;

//     // Weight configuration (defaults: 25% Keyword, 25% Concept, 30% Semantic, 20% AI)
//     const rawKW = typeof config.keywordWeight === 'number' ? config.keywordWeight : 25;
//     const rawCW = typeof config.conceptWeight === 'number' ? config.conceptWeight : 25;
//     const rawSW = typeof config.semanticWeight === 'number' ? config.semanticWeight : 30;
//     const rawAW = typeof config.aiWeight === 'number' ? config.aiWeight : 20;

//     const cleanAnswer = String(studentAnswer || '').trim();

//     // 1. Handle Empty / Whitespace-only Answer
//     if (!cleanAnswer) {
//       return this.buildResultPayload({
//         score: 0,
//         confidence: 100,
//         maxMarks,
//         keywordScore: 0,
//         conceptScore: 0,
//         semanticScore: 0,
//         aiScore: 0,
//         matchedKeywords: [],
//         missingKeywords: keywords,
//         matchedConcepts: [],
//         missingConcepts: keyConcepts,
//         incorrectClaims: [],
//         reason: 'Candidate did not provide an answer.',
//         status: 'AUTO_GRADED',
//         evaluatedBy: 'DETERMINISTIC_ENGINE'
//       });
//     }

//     // 2. Handle Meaningless / Ultra-short Answers (e.g. "yes", "idk", "asdf", single word non-answers)
//     const words = cleanAnswer.split(/\s+/).filter(Boolean);
//     const meaninglessPatterns = /^(yes|no|ok|okay|idk|i don'?t know|none|nothing|skip|pass|hello|hi|\.+|\?+|n\/a)$/i;
    
//     if (words.length <= 2 && (meaninglessPatterns.test(cleanAnswer) || cleanAnswer.length < 4)) {
//       // Check if expected answer was also a very short single word
//       const expectedWords = expectedAnswer.trim().split(/\s+/).filter(Boolean);
//       if (expectedWords.length > 2) {
//         return this.buildResultPayload({
//           score: 0,
//           confidence: 95,
//           maxMarks,
//           keywordScore: 0,
//           conceptScore: 0,
//           semanticScore: 0,
//           aiScore: 0,
//           matchedKeywords: [],
//           missingKeywords: keywords,
//           matchedConcepts: [],
//           missingConcepts: keyConcepts,
//           incorrectClaims: [],
//           reason: 'Candidate provided a non-substantive or meaningless response.',
//           status: 'AUTO_GRADED',
//           evaluatedBy: 'DETERMINISTIC_ENGINE'
//         });
//       }
//     }

//     // 3. Local Deterministic Engines: Keyword, Concept, Semantic, and Contradictions
//     const keywordRes = this.evaluateKeywords(cleanAnswer, keywords);
//     const conceptRes = this.evaluateConcepts(cleanAnswer, keyConcepts, expectedAnswer);
//     const semanticRes = this.evaluateSemanticSimilarity(cleanAnswer, expectedAnswer);
//     const contradictionRes = this.detectContradictions(cleanAnswer, expectedAnswer, keyConcepts);

//     let aiRes = null;
//     let aiEvaluationUsed = false;
//     let fallbackUsed = false;

//     // 4. AI Evaluation (if enabled & configured)
//     if (isAiEnabled && aiProvider.isConfigured()) {
//       try {
//         const aiCallResult = await aiProvider.evaluateSubjectiveAnswer({
//           questionText,
//           maxMarks,
//           expectedAnswer,
//           keywords,
//           keyConcepts,
//           rubric,
//           studentAnswer: cleanAnswer,
//           customInstructions
//         });

//         if (aiCallResult.success && aiCallResult.data) {
//           aiRes = aiCallResult.data;
//           aiEvaluationUsed = true;
//         } else {
//           fallbackUsed = true;
//         }
//       } catch (err) {
//         fallbackUsed = true;
//       }
//     } else {
//       fallbackUsed = !isAiEnabled ? false : true;
//     }

//     // 5. Score Aggregation
//     let finalScore = 0;
//     let confidenceScore = 80;
//     let reason = '';
//     let incorrectClaims = contradictionRes.incorrectClaims || [];

//     if (aiEvaluationUsed && aiRes) {
//       // Merge AI concept and contradiction findings
//       if (Array.isArray(aiRes.incorrectClaims) && aiRes.incorrectClaims.length > 0) {
//         incorrectClaims = Array.from(new Set([...incorrectClaims, ...aiRes.incorrectClaims]));
//       }

//       // Merge matched and missing concepts
//       const combinedMatchedConcepts = Array.from(new Set([...conceptRes.matchedConcepts, ...(aiRes.matchedConcepts || [])]));
//       const combinedMissingConcepts = (keyConcepts || []).filter(c => !combinedMatchedConcepts.some(m => m.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(m.toLowerCase())));

//       const totalWeight = rawKW + rawCW + rawSW + rawAW || 100;
//       const kwPart = (keywordRes.score * rawKW) / totalWeight;
//       const cnPart = (conceptRes.score * rawCW) / totalWeight;
//       const smPart = (semanticRes.score * rawSW) / totalWeight;
//       const aiPart = (aiRes.correctnessScore * rawAW) / totalWeight;

//       finalScore = kwPart + cnPart + smPart + aiPart;

//       // Penalize for detected contradictions
//       if (incorrectClaims.length > 0) {
//         const penalty = Math.min(40, incorrectClaims.length * 20);
//         finalScore = Math.max(0, finalScore - penalty);
//       }

//       finalScore = Math.min(100, Math.max(0, Math.round(finalScore)));

//       // Confidence score synthesis
//       const scoresList = [keywordRes.score, conceptRes.score, semanticRes.score, aiRes.correctnessScore];
//       const variance = this.calculateVariance(scoresList);
//       confidenceScore = Math.round(Math.max(40, Math.min(98, (aiRes.confidenceScore || 80) - (variance / 15) - (incorrectClaims.length * 10))));

//       reason = aiRes.reason || `Evaluated by AI Engine with ${finalScore}% overall alignment.`;

//       const status = this.determineEvaluationStatus({
//         score: finalScore,
//         confidence: confidenceScore,
//         threshold,
//         needsManualReview: aiRes.needsManualReview,
//         hasContradictions: incorrectClaims.length > 0,
//         isFallback: false
//       });

//       return this.buildResultPayload({
//         score: finalScore,
//         confidence: confidenceScore,
//         maxMarks,
//         keywordScore: keywordRes.score,
//         conceptScore: conceptRes.score,
//         semanticScore: semanticRes.score,
//         aiScore: aiRes.correctnessScore,
//         matchedKeywords: keywordRes.matchedKeywords,
//         missingKeywords: keywordRes.missingKeywords,
//         matchedConcepts: combinedMatchedConcepts,
//         missingConcepts: combinedMissingConcepts,
//         incorrectClaims,
//         reason,
//         status,
//         evaluatedBy: `AI_EVALUATOR (${aiProvider.modelName})`
//       });
//     }

//     // 6. Fallback Deterministic Evaluation (When AI is disabled / unavailable / timed out)
//     const localTotalWeight = rawKW + rawCW + rawSW || 80;
//     const kwPart = (keywordRes.score * rawKW) / localTotalWeight;
//     const cnPart = (conceptRes.score * rawCW) / localTotalWeight;
//     const smPart = (semanticRes.score * rawSW) / localTotalWeight;

//     finalScore = kwPart + cnPart + smPart;

//     if (incorrectClaims.length > 0) {
//       const penalty = Math.min(40, incorrectClaims.length * 20);
//       finalScore = Math.max(0, finalScore - penalty);
//     }

//     finalScore = Math.min(100, Math.max(0, Math.round(finalScore)));

//     const scoresList = [keywordRes.score, conceptRes.score, semanticRes.score];
//     const variance = this.calculateVariance(scoresList);
//     confidenceScore = Math.round(Math.max(45, Math.min(88, 80 - (variance / 12) - (incorrectClaims.length * 15))));

//     reason = fallbackUsed 
//       ? `AI evaluation unavailable — deterministic fallback evaluation applied based on keyword (${keywordRes.score}%), concept (${conceptRes.score}%), and semantic similarity (${semanticRes.score}%).`
//       : `Evaluated using local keyword, concept, and semantic matching.`;

//     const status = this.determineEvaluationStatus({
//       score: finalScore,
//       confidence: confidenceScore,
//       threshold,
//       needsManualReview: false,
//       hasContradictions: incorrectClaims.length > 0,
//       isFallback: fallbackUsed
//     });

//     return this.buildResultPayload({
//       score: finalScore,
//       confidence: confidenceScore,
//       maxMarks,
//       keywordScore: keywordRes.score,
//       conceptScore: conceptRes.score,
//       semanticScore: semanticRes.score,
//       aiScore: 0,
//       matchedKeywords: keywordRes.matchedKeywords,
//       missingKeywords: keywordRes.missingKeywords,
//       matchedConcepts: conceptRes.matchedConcepts,
//       missingConcepts: conceptRes.missingConcepts,
//       incorrectClaims,
//       reason,
//       status,
//       evaluatedBy: fallbackUsed ? 'FALLBACK_DETERMINISTIC_ENGINE' : 'LOCAL_EVALUATOR'
//     });
//   }

//   /**
//    * Robust Keyword Matching with word stem & synonym equivalence
//    */
//   evaluateKeywords(studentText, expectedKeywords = []) {
//     if (!Array.isArray(expectedKeywords) || expectedKeywords.length === 0) {
//       return { score: 100, matchedKeywords: [], missingKeywords: [] };
//     }

//     const normalizedStudent = this.normalizeText(studentText);
//     const matchedKeywords = [];
//     const missingKeywords = [];

//     for (const kw of expectedKeywords) {
//       if (!kw || !String(kw).trim()) continue;
//       const cleanKw = String(kw).trim().toLowerCase();
      
//       if (this.checkKeywordMatch(normalizedStudent, cleanKw)) {
//         matchedKeywords.push(kw);
//       } else {
//         missingKeywords.push(kw);
//       }
//     }

//     const total = matchedKeywords.length + missingKeywords.length;
//     const score = total > 0 ? Math.round((matchedKeywords.length / total) * 100) : 100;

//     return { score, matchedKeywords, missingKeywords };
//   }

//   checkKeywordMatch(normalizedStudentText, keyword) {
//     const normKw = this.normalizeText(keyword);
    
//     // Direct substring match
//     if (normalizedStudentText.includes(normKw)) return true;

//     // Check synonym map
//     for (const [key, synList] of Object.entries(SYNONYM_MAP)) {
//       if (normKw.includes(key) || key.includes(normKw)) {
//         for (const syn of synList) {
//           if (normalizedStudentText.includes(syn.toLowerCase())) {
//             return true;
//           }
//         }
//       }
//     }

//     // Token stem match for multi-word keywords (e.g. "data redundancy" -> "data" and ("redundant" or "duplicat"))
//     const kwTokens = normKw.split(/\s+/).filter(Boolean);
//     if (kwTokens.length > 1) {
//       const allTokensFound = kwTokens.every(tok => {
//         const stem = tok.slice(0, Math.max(3, tok.length - 2));
//         return normalizedStudentText.includes(stem);
//       });
//       if (allTokensFound) return true;
//     }

//     return false;
//   }

//   /**
//    * Concept Matching Engine
//    */
//   evaluateConcepts(studentText, keyConcepts = [], expectedAnswer = '') {
//     if (!Array.isArray(keyConcepts) || keyConcepts.length === 0) {
//       if (expectedAnswer && expectedAnswer.trim()) {
//         // Derive key phrases from expected answer if keyConcepts not provided
//         const extracted = expectedAnswer
//           .split(/[,.;\n]+/)
//           .map(s => s.trim())
//           .filter(s => s.length > 3 && s.split(/\s+/).length >= 2);
//         return this.evaluateConcepts(studentText, extracted.slice(0, 5), '');
//       }
//       return { score: 100, matchedConcepts: [], missingConcepts: [] };
//     }

//     const normalizedStudent = this.normalizeText(studentText);
//     const matchedConcepts = [];
//     const missingConcepts = [];

//     for (const concept of keyConcepts) {
//       if (!concept || !String(concept).trim()) continue;
//       const cleanConcept = String(concept).trim().toLowerCase();
      
//       let matched = this.checkKeywordMatch(normalizedStudent, cleanConcept);
      
//       if (!matched) {
//         // Fuzzy concept alignment
//         const conceptWords = cleanConcept.split(/\s+/).filter(w => w.length > 2);
//         const matchCount = conceptWords.filter(w => normalizedStudent.includes(w.slice(0, Math.max(3, w.length - 1)))).length;
//         if (conceptWords.length > 0 && (matchCount / conceptWords.length) >= 0.6) {
//           matched = true;
//         }
//       }

//       if (matched) {
//         matchedConcepts.push(concept);
//       } else {
//         missingConcepts.push(concept);
//       }
//     }

//     const total = matchedConcepts.length + missingConcepts.length;
//     const score = total > 0 ? Math.round((matchedConcepts.length / total) * 100) : 100;

//     return { score, matchedConcepts, missingConcepts };
//   }

//   /**
//    * Semantic Similarity Engine using normalized TF-IDF n-gram overlap & token edit metrics
//    */
//   evaluateSemanticSimilarity(studentText, expectedText) {
//     if (!expectedText || !expectedText.trim()) return { score: 80 };

//     const normStudent = this.normalizeText(studentText);
//     const normExpected = this.normalizeText(expectedText);

//     if (normStudent === normExpected) return { score: 100 };

//     const studentTokens = normStudent.split(/\s+/).filter(w => w.length > 1);
//     const expectedTokens = normExpected.split(/\s+/).filter(w => w.length > 1);

//     if (studentTokens.length === 0) return { score: 0 };

//     // 1. Jaccard token overlap
//     const studentSet = new Set(studentTokens);
//     const expectedSet = new Set(expectedTokens);
//     let intersection = 0;
//     studentSet.forEach(t => { if (expectedSet.has(t)) intersection++; });
//     const union = new Set([...studentTokens, ...expectedTokens]).size;
//     const jaccardScore = union > 0 ? (intersection / union) * 100 : 0;

//     // 2. Bigram overlap
//     const studentBigrams = this.getBigrams(studentTokens);
//     const expectedBigrams = this.getBigrams(expectedTokens);
//     let bigramOverlap = 0;
//     studentBigrams.forEach(b => { if (expectedBigrams.has(b)) bigramOverlap++; });
//     const bigramScore = expectedBigrams.size > 0 ? (bigramOverlap / expectedBigrams.size) * 100 : jaccardScore;

//     // 3. Expected coverage ratio (how much of expected vocabulary was captured)
//     const expectedCoverage = expectedTokens.length > 0 ? (intersection / expectedSet.size) * 100 : 0;

//     const compositeScore = Math.round((jaccardScore * 0.3) + (bigramScore * 0.3) + (expectedCoverage * 0.4));
//     return { score: Math.min(100, Math.max(0, compositeScore)) };
//   }

//   getBigrams(tokens) {
//     const bigrams = new Set();
//     for (let i = 0; i < tokens.length - 1; i++) {
//       bigrams.add(`${tokens[i]} ${tokens[i + 1]}`);
//     }
//     return bigrams;
//   }

//   /**
//    * Contradiction & False Claim Detection
//    */
//   detectContradictions(studentText, expectedText, keyConcepts = []) {
//     const incorrectClaims = [];
//     const normStudent = this.normalizeText(studentText);
//     const normExpected = this.normalizeText(expectedText);

//     // Contradiction patterns in hardware / memory / CS terms
//     const contradictionRules = [
//       {
//         expectedPattern: /\b(volatile)\b/i,
//         contradictionPattern: /\b(non-volatile|permanent storage|does not lose|never lost)\b/i,
//         subject: 'RAM / Volatile Memory',
//         claim: 'Incorrectly claims volatile memory is non-volatile / permanent.'
//       },
//       {
//         expectedPattern: /\b(non-volatile)\b/i,
//         contradictionPattern: /\b(volatile|temporary memory|lost when powered off)\b/i,
//         subject: 'ROM / Secondary Storage',
//         claim: 'Incorrectly claims non-volatile storage is volatile.'
//       },
//       {
//         expectedPattern: /\b(reduces|eliminates|prevents)\s+(data\s+)?redundancy\b/i,
//         contradictionPattern: /\b(increases|creates|promotes)\s+(data\s+)?redundancy\b/i,
//         subject: 'DBMS Data Redundancy',
//         claim: 'Incorrectly claims DBMS increases data redundancy.'
//       },
//       {
//         expectedPattern: /\b(relational|sql)\b/i,
//         contradictionPattern: /\b(is a non-relational|is nosql)\b/i,
//         subject: 'RDBMS',
//         claim: 'Incorrectly categorizes relational database.'
//       }
//     ];

//     for (const rule of contradictionRules) {
//       if (rule.expectedPattern.test(normExpected) && rule.contradictionPattern.test(normStudent)) {
//         incorrectClaims.push(rule.claim);
//       }
//     }

//     return {
//       hasContradiction: incorrectClaims.length > 0,
//       incorrectClaims
//     };
//   }

//   /**
//    * Determine evaluation status based on score, confidence, threshold, and contradictions
//    */
//   determineEvaluationStatus({
//     score,
//     confidence,
//     threshold,
//     needsManualReview = false,
//     hasContradictions = false,
//     isFallback = false
//   }) {
//     if (isFallback) {
//       return 'FALLBACK_EVALUATION';
//     }

//     if (hasContradictions || needsManualReview) {
//       return 'MANUAL_REVIEW_REQUIRED';
//     }

//     if (score >= threshold && confidence >= 70) {
//       return 'AUTO_GRADED';
//     }

//     if (score >= (threshold - 10)) {
//       return 'AUTO_GRADED_REVIEW_RECOMMENDED';
//     }

//     if (confidence < 60) {
//       return 'MANUAL_REVIEW_REQUIRED';
//     }

//     return 'AUTO_GRADED';
//   }

//   /**
//    * Calculate Variance of an array of numeric scores
//    */
//   calculateVariance(arr) {
//     if (!arr || arr.length === 0) return 0;
//     const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
//     const sqDiffs = arr.map(v => Math.pow(v - mean, 2));
//     return sqDiffs.reduce((a, b) => a + b, 0) / arr.length;
//   }

//   normalizeText(str) {
//     if (!str) return '';
//     return String(str)
//       .toLowerCase()
//       .replace(/[^\w\s-]/g, ' ')
//       .replace(/\s+/g, ' ')
//       .trim();
//   }

//   buildResultPayload({
//     score,
//     confidence,
//     maxMarks,
//     keywordScore,
//     conceptScore,
//     semanticScore,
//     aiScore,
//     matchedKeywords,
//     missingKeywords,
//     matchedConcepts,
//     missingConcepts,
//     incorrectClaims,
//     reason,
//     status,
//     evaluatedBy
//   }) {
//     // Proportional mark allocation clamped between 0 and maxMarks
//     const awardedMarks = Number(Math.min(maxMarks, Math.max(0, (maxMarks * score) / 100)).toFixed(2));
//     const isCorrect = score >= 70 && (!incorrectClaims || incorrectClaims.length === 0);

//     return {
//       evaluationStatus: status,
//       evaluationScore: score,
//       confidenceScore: confidence,
//       awardedMarks,
//       maximumMarks: maxMarks,
//       keywordScore,
//       conceptScore,
//       semanticScore,
//       aiScore,
//       matchedKeywords,
//       missingKeywords,
//       matchedConcepts,
//       missingConcepts,
//       incorrectClaims,
//       evaluationReason: reason,
//       isCorrect,
//       evaluatedAt: new Date(),
//       evaluatedBy,
//       evaluationVersion: this.version,
//       originalAiSuggestedMarks: awardedMarks
//     };
//   }
// }

// module.exports = new SubjectiveEvaluationService();

/**
 * Subjective / Descriptive Evaluation Service - GLB ExamSphere
 * Multi-layer evaluation combining Keyword Matching, Concept Matching,
 * Semantic Similarity, Contradiction Detection, and AI Evaluation with Safe Fallbacks.
 */

const aiProvider = require('./aiProvider');

const SYNONYM_MAP = {
  'redundancy': ['duplicate', 'duplication', 'duplicate data', 'repeating data', 'copies', 'multiple copies'],
  'security': ['protection', 'access control', 'authorization', 'confidentiality', 'privacy'],
  'consistency': ['integrity', 'uniformity', 'accuracy', 'coherent', 'valid state'],
  'sharing': ['concurrent access', 'multi-user', 'multiple users', 'collaborative'],
  'concurrency': ['parallel', 'simultaneous', 'multi-threading', 'concurrent transactions']
};

class SubjectiveEvaluationService {
  constructor() {
    this.version = 'subjective-v1';
  }

  async evaluateAnswer({ question, studentAnswer = '', customInstructions = '' }) {
    const maxMarks = Math.max(0.5, Number(question.marks) || 1);
    const expectedAnswer = question.expectedAnswer || '';
    const keywords = Array.isArray(question.keywords) ? question.keywords : [];
    const keyConcepts = Array.isArray(question.keyConcepts) ? question.keyConcepts : [];
    const rubric = Array.isArray(question.rubric) ? question.rubric : [];
    const config = question.evaluationConfig || {};

    const isAiEnabled = config.enabled !== false;
    const threshold = typeof config.threshold === 'number' ? config.threshold : 70;

    const rawKW = typeof config.keywordWeight === 'number' ? config.keywordWeight : 25;
    const rawCW = typeof config.conceptWeight === 'number' ? config.conceptWeight : 25;
    const rawSW = typeof config.semanticWeight === 'number' ? config.semanticWeight : 30;
    const rawAW = typeof config.aiWeight === 'number' ? config.aiWeight : 20;

    const cleanAnswer = String(studentAnswer || '').trim();

    // 1. Handle Empty Answer
    if (!cleanAnswer) {
      return this.buildResultPayload({
        awardedMarks: 0,
        maximumMarks: maxMarks,
        evaluationStatus: 'AUTO_GRADED',
        evaluationScore: 0,
        confidenceScore: 100,
        keywordScore: 0,
        conceptScore: 0,
        semanticScore: 0,
        aiScore: 0,
        matchedKeywords: [],
        missingKeywords: keywords,
        matchedConcepts: [],
        missingConcepts: keyConcepts,
        incorrectClaims: [],
        evaluationReason: 'Candidate submitted an empty answer.'
      });
    }

    // 2. Multi-Signal Deterministic Metrics
    const kwResult = this.calculateKeywordScore(cleanAnswer, keywords);
    const conceptResult = this.calculateConceptScore(cleanAnswer, keyConcepts);
    const semanticScore = this.calculateSemanticScore(cleanAnswer, expectedAnswer);
    const contradictionResult = this.detectContradictions(cleanAnswer, expectedAnswer);

    // 3. AI Rubric Evaluation with Safe Fallback
    let aiScore = 0;
    let aiConfidence = 85;
    let aiIncorrectClaims = [];
    let aiMissingConcepts = [];
    let aiReason = '';
    let isAiFallback = false;

    if (isAiEnabled && expectedAnswer) {
      try {
        const aiResponse = await aiProvider.evaluateSubjectiveAnswer({
          questionText: question.questionText,
          expectedAnswer,
          keywords,
          keyConcepts,
          rubric,
          studentAnswer: cleanAnswer,
          maxMarks
        });

        if (aiResponse && aiResponse.success) {
          aiScore = Math.max(0, Math.min(100, Number(aiResponse.correctnessScore) || 0));
          aiConfidence = Math.max(0, Math.min(100, Number(aiResponse.confidenceScore) || 80));
          aiReason = aiResponse.reason || 'AI evaluation complete.';
          if (Array.isArray(aiResponse.incorrectClaims)) aiIncorrectClaims = aiResponse.incorrectClaims;
          if (Array.isArray(aiResponse.missingConcepts)) aiMissingConcepts = aiResponse.missingConcepts;
        } else {
          isAiFallback = true;
        }
      } catch (err) {
        isAiFallback = true;
      }
    } else {
      isAiFallback = true;
    }

    // 4. Weighted Aggregation
    let effectiveKW = rawKW;
    let effectiveCW = rawCW;
    let effectiveSW = rawSW;
    let effectiveAW = isAiFallback ? 0 : rawAW;
    const totalEffectiveWeight = effectiveKW + effectiveCW + effectiveSW + effectiveAW || 1;

    let aggregateScore = (
      (kwResult.score * effectiveKW) +
      (conceptResult.score * effectiveCW) +
      (semanticScore * effectiveSW) +
      (aiScore * effectiveAW)
    ) / totalEffectiveWeight;

    // Apply contradiction deduction
    const allContradictions = Array.from(new Set([...contradictionResult.contradictions, ...aiIncorrectClaims]));
    if (allContradictions.length > 0) {
      aggregateScore = Math.max(0, aggregateScore - (allContradictions.length * 20));
    }

    const finalScore = Math.min(100, Math.max(0, Math.round(aggregateScore * 10) / 10));

    // 5. Convert to Marks (Rounded to nearest 0.5)
    const rawMarks = (maxMarks * finalScore) / 100;
    const awardedMarks = Math.round(rawMarks * 2) / 2;

    // 6. Evaluation Status
    let status = 'AUTO_GRADED';
    if (allContradictions.length > 0 || finalScore < 40) {
      status = 'MANUAL_REVIEW_REQUIRED';
    } else if (finalScore < threshold) {
      status = 'AUTO_GRADED_REVIEW_RECOMMENDED';
    }

    return this.buildResultPayload({
      awardedMarks,
      maximumMarks: maxMarks,
      evaluationStatus: status,
      evaluationScore: finalScore,
      confidenceScore: aiConfidence,
      keywordScore: kwResult.score,
      conceptScore: conceptResult.score,
      semanticScore: semanticScore,
      aiScore: isAiFallback ? null : aiScore,
      matchedKeywords: kwResult.matched,
      missingKeywords: kwResult.missing,
      matchedConcepts: conceptResult.matched,
      missingConcepts: conceptResult.missing,
      incorrectClaims: allContradictions,
      evaluationReason: isAiFallback ? 'Multi-signal deterministic evaluation applied.' : aiReason
    });
  }

  calculateKeywordScore(answer, keywords) {
    if (!keywords || keywords.length === 0) return { score: 100, matched: [], missing: [] };
    const lower = answer.toLowerCase();
    const matched = [];
    const missing = [];

    for (const kw of keywords) {
      const cleanKW = kw.trim().toLowerCase();
      if (!cleanKW) continue;
      const synonyms = SYNONYM_MAP[cleanKW] || [];
      const targets = [cleanKW, ...synonyms];
      const found = targets.some(t => lower.includes(t));
      if (found) matched.push(kw);
      else missing.push(kw);
    }
    const score = Math.round((matched.length / keywords.length) * 100);
    return { score, matched, missing };
  }

  calculateConceptScore(answer, concepts) {
    if (!concepts || concepts.length === 0) return { score: 100, matched: [], missing: [] };
    const lower = answer.toLowerCase();
    const matched = [];
    const missing = [];

    for (const concept of concepts) {
      const tokens = concept.toLowerCase().split(/\s+/).filter(Boolean);
      const matchCount = tokens.filter(t => lower.includes(t)).length;
      if (matchCount / tokens.length >= 0.6) matched.push(concept);
      else missing.push(concept);
    }
    const score = Math.round((matched.length / concepts.length) * 100);
    return { score, matched, missing };
  }

  calculateSemanticScore(answer, expected) {
    if (!expected) return 50;
    const ansWords = new Set(answer.toLowerCase().match(/\b\w{3,}\b/g) || []);
    const expWords = new Set(expected.toLowerCase().match(/\b\w{3,}\b/g) || []);
    if (expWords.size === 0) return 100;

    let overlap = 0;
    for (const word of ansWords) {
      if (expWords.has(word)) overlap++;
    }
    const jaccard = overlap / (ansWords.size + expWords.size - overlap || 1);
    return Math.min(100, Math.round(jaccard * 150));
  }

  detectContradictions(answer, expected) {
    const lower = answer.toLowerCase();
    const contradictions = [];
    if (lower.includes('not share memory') && lower.includes('thread')) {
      contradictions.push('Incorrectly states threads do not share memory');
    }
    return { contradictions };
  }

  buildResultPayload(data) {
    return {
      version: this.version,
      evaluatedAt: new Date(),
      ...data
    };
  }
}

module.exports = new SubjectiveEvaluationService();