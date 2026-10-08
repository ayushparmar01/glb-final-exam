// /**
//  * AI Provider Abstraction - GLB ExamSphere
//  * Provides modular integration with Google Gemini (@google/genai) and extensibility
//  * with strict JSON response validation, timeout protection, retry limits, and safe fallbacks.
//  */

// class AIProvider {
//   constructor() {
//     this.apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '';
//     this.modelName = process.env.AI_MODEL || 'gemini-2.5-flash';
//     this.timeoutMs = parseInt(process.env.AI_TIMEOUT_MS, 10) || 10000;
//     this.enabled = process.env.AI_EVALUATION_ENABLED !== 'false';
//   }

//   isConfigured() {
//     return Boolean(this.enabled && (this.apiKey || process.env.GEMINI_API_KEY));
//   }

//   /**
//    * Helper to execute a promise with timeout
//    */
//   async withTimeout(promise, ms = this.timeoutMs) {
//     let timer;
//     const timeoutPromise = new Promise((_, reject) => {
//       timer = setTimeout(() => {
//         reject(new Error(`AI evaluation request timed out after ${ms}ms`));
//       }, ms);
//     });
//     try {
//       const result = await Promise.race([promise, timeoutPromise]);
//       clearTimeout(timer);
//       return result;
//     } catch (err) {
//       clearTimeout(timer);
//       throw err;
//     }
//   }

//   /**
//    * Evaluate a student's subjective answer against expected answer, keywords, concepts, and rubric.
//    * STRICT JSON ONLY output.
//    */
//   async evaluateSubjectiveAnswer({
//     questionText,
//     maxMarks = 5,
//     expectedAnswer = '',
//     keywords = [],
//     keyConcepts = [],
//     rubric = [],
//     studentAnswer = '',
//     customInstructions = ''
//   }) {
//     if (!this.isConfigured()) {
//       return {
//         success: false,
//         error: 'AI Provider is not configured or disabled (missing GEMINI_API_KEY or AI_EVALUATION_ENABLED=false)'
//       };
//     }

//     const cleanStudentAns = String(studentAnswer || '').trim();
//     if (!cleanStudentAns) {
//       return {
//         success: true,
//         data: {
//           correctnessScore: 0,
//           confidenceScore: 100,
//           suggestedMarks: 0,
//           keywordCoverage: 0,
//           conceptCoverage: 0,
//           semanticCorrectness: 0,
//           isCorrect: false,
//           needsManualReview: false,
//           matchedConcepts: [],
//           missingConcepts: keyConcepts,
//           incorrectClaims: [],
//           reason: 'No answer provided by the candidate.'
//         }
//       };
//     }

//     try {
//       const { GoogleGenAI } = require('@google/genai');
//       const key = this.apiKey || process.env.GEMINI_API_KEY;
//       const ai = new GoogleGenAI({ apiKey: key });

//       const rubricText = Array.isArray(rubric) && rubric.length > 0
//         ? rubric.map((r, i) => `${i + 1}. [${r.criterion || 'Criterion'} - Max ${r.marks || 1} marks]: ${r.description || ''}`).join('\n')
//         : 'Standard proportional grading based on concept coverage and factual correctness.';

//       const systemPrompt = `You are a strict, objective, and fair academic evaluator assessing a student's exam response.
// Your primary task is to evaluate the FACTUAL CORRECTNESS and CONCEPTUAL ACCURACY of the student's answer by comparing it against the expected answer, key concepts, keywords, and rubric provided by the teacher.

// CRITICAL EVALUATION RULES:
// 1. Compare primarily against the Expected Answer, Key Concepts, and Teacher Rubric.
// 2. Do NOT mark an answer correct merely because it is fluent or long. A short answer can be 100% correct if it covers the key points.
// 3. Do NOT give extra marks for fancy vocabulary or grammar unless required.
// 4. CONTRADICTION DETECTION: If the student makes false claims or contradicts the expected answer (e.g., claiming RAM is non-volatile, or SQL is NoSQL), penalize the correctness score heavily and list the statement in "incorrectClaims".
// 5. KEYWORD & CONCEPT MATCHING: Recognize semantic equivalents and synonyms (e.g., "prevents duplicate data" = "reduces data redundancy").
// 6. Clamp all score fields between 0 and 100. Clamp suggestedMarks between 0 and ${maxMarks}.
// 7. Return STRICT JSON ONLY without markdown backticks or commentary.`;

//       const userContent = `Evaluate the following exam response:

// --- QUESTION DETAILS ---
// Question: "${questionText}"
// Maximum Marks: ${maxMarks}

// Expected Answer / Reference Model:
// "${expectedAnswer || 'N/A'}"

// Key Keywords:
// ${JSON.stringify(keywords || [])}

// Key Concepts Required:
// ${JSON.stringify(keyConcepts || [])}

// Teacher Rubric / Marking Scheme:
// ${rubricText}
// ${customInstructions ? `Special Grading Instructions: ${customInstructions}` : ''}

// --- STUDENT'S SUBMITTED ANSWER ---
// "${cleanStudentAns}"

// --- OUTPUT SCHEMA REQUIRED (STRICT JSON ONLY) ---
// {
//   "correctnessScore": <number 0-100>,
//   "confidenceScore": <number 0-100, how confident you are in this grade>,
//   "suggestedMarks": <number 0 to ${maxMarks}>,
//   "keywordCoverage": <number 0-100>,
//   "conceptCoverage": <number 0-100>,
//   "semanticCorrectness": <number 0-100>,
//   "isCorrect": <boolean>,
//   "needsManualReview": <boolean, true if ambiguous, highly borderline, or uncertain>,
//   "matchedConcepts": [<string>, ...],
//   "missingConcepts": [<string>, ...],
//   "incorrectClaims": [<string>, ...],
//   "reason": "<concise 1-3 sentence explanation of the grading justification>"
// }`;

//       const aiCall = ai.models.generateContent({
//         model: this.modelName,
//         contents: [
//           { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userContent}` }] }
//         ]
//       });

//       const response = await this.withTimeout(aiCall, this.timeoutMs);
//       const responseText = response.text || '';
//       const cleanJson = responseText
//         .replace(/```(?:json)?/gi, '')
//         .replace(/```/g, '')
//         .trim();

//       const parsed = JSON.parse(cleanJson);
//       const validated = this.validateAndSanitizeOutput(parsed, maxMarks, keyConcepts);

//       return {
//         success: true,
//         data: validated
//       };
//     } catch (err) {
//       return {
//         success: false,
//         error: err.message || 'AI evaluation failed'
//       };
//     }
//   }

//   /**
//    * Validate and clamp AI output values to strict ranges
//    */
//   validateAndSanitizeOutput(raw, maxMarks, expectedConcepts = []) {
//     if (!raw || typeof raw !== 'object') {
//       throw new Error('AI output is not a valid JSON object');
//     }

//     const clamp = (val, min, max, fallback = 0) => {
//       const num = Number(val);
//       if (isNaN(num)) return fallback;
//       return Math.min(max, Math.max(min, num));
//     };

//     const correctnessScore = clamp(raw.correctnessScore, 0, 100, 0);
//     const confidenceScore = clamp(raw.confidenceScore, 0, 100, 75);
//     const keywordCoverage = clamp(raw.keywordCoverage, 0, 100, correctnessScore);
//     const conceptCoverage = clamp(raw.conceptCoverage, 0, 100, correctnessScore);
//     const semanticCorrectness = clamp(raw.semanticCorrectness, 0, 100, correctnessScore);
    
//     // Clamp suggested marks
//     let suggestedMarks = clamp(raw.suggestedMarks, 0, maxMarks, (maxMarks * correctnessScore) / 100);
//     suggestedMarks = Number(suggestedMarks.toFixed(2));

//     const isCorrect = typeof raw.isCorrect === 'boolean' 
//       ? raw.isCorrect 
//       : (correctnessScore >= 70);

//     const needsManualReview = typeof raw.needsManualReview === 'boolean'
//       ? raw.needsManualReview
//       : (confidenceScore < 65 || (correctnessScore >= 60 && correctnessScore <= 75));

//     const matchedConcepts = Array.isArray(raw.matchedConcepts)
//       ? raw.matchedConcepts.map(String).filter(Boolean)
//       : [];

//     const missingConcepts = Array.isArray(raw.missingConcepts)
//       ? raw.missingConcepts.map(String).filter(Boolean)
//       : [];

//     const incorrectClaims = Array.isArray(raw.incorrectClaims)
//       ? raw.incorrectClaims.map(String).filter(Boolean)
//       : [];

//     const reason = typeof raw.reason === 'string' && raw.reason.trim()
//       ? raw.reason.trim().slice(0, 500)
//       : `Evaluated score: ${correctnessScore}% based on reference comparison.`;

//     return {
//       correctnessScore,
//       confidenceScore,
//       suggestedMarks,
//       keywordCoverage,
//       conceptCoverage,
//       semanticCorrectness,
//       isCorrect,
//       needsManualReview,
//       matchedConcepts,
//       missingConcepts,
//       incorrectClaims,
//       reason
//     };
//   }
// }

// module.exports = new AIProvider();

/**
 * AI Provider Service - Google Gemini with Timeout and Schema Enforcement
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

class AIProvider {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || '';
    this.timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 7000;
  }

  async evaluateSubjectiveAnswer({ questionText, expectedAnswer, keywords, keyConcepts, rubric, studentAnswer, maxMarks }) {
    if (!this.apiKey) {
      return { success: false, error: 'GEMINI_API_KEY_NOT_CONFIGURED' };
    }

    try {
      const genAI = new GoogleGenerativeAI(this.apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const prompt = `
You are an expert academic examiner. Evaluate the student answer strictly based on the question and expected reference.

Question: ${questionText}
Maximum Marks: ${maxMarks}
Expected Answer: ${expectedAnswer}
Keywords: ${keywords.join(', ')}
Key Concepts: ${keyConcepts.join(', ')}
Student Answer: "${studentAnswer}"

Return ONLY a valid JSON object matching this schema:
{
  "correctnessScore": <number 0-100>,
  "confidenceScore": <number 0-100>,
  "conceptCoverage": <number 0-100>,
  "reason": "<short 1-2 sentence explanation>",
  "incorrectClaims": ["<any factual errors>"],
  "missingConcepts": ["<missing key points>"]
}
`;

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AI_EVALUATION_TIMEOUT')), this.timeoutMs)
      );

      const aiCallPromise = model.generateContent(prompt).then(res => res.response.text());
      const rawText = await Promise.race([aiCallPromise, timeoutPromise]);

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('MALFORMED_AI_RESPONSE');

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        correctnessScore: Math.min(100, Math.max(0, Number(parsed.correctnessScore) || 0)),
        confidenceScore: Math.min(100, Math.max(0, Number(parsed.confidenceScore) || 80)),
        conceptCoverage: Math.min(100, Math.max(0, Number(parsed.conceptCoverage) || 0)),
        reason: String(parsed.reason || 'AI evaluation complete.'),
        incorrectClaims: Array.isArray(parsed.incorrectClaims) ? parsed.incorrectClaims : [],
        missingConcepts: Array.isArray(parsed.missingConcepts) ? parsed.missingConcepts : []
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = new AIProvider();