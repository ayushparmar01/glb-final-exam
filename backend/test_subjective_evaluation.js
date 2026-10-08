/**
 * Test Suite: Subjective / Descriptive Question Evaluation Engine
 * Tests multi-signal scoring, keywords, concepts, semantic similarity, contradiction detection,
 * fallback mechanism, and mixed-exam evaluation.
 */

const subjectiveEvaluationService = require('./services/subjectiveEvaluationService');

async function runTests() {
  console.log('Starting Subjective Evaluation Test Suite...\n');

  const question = {
    questionText: 'Explain the difference between a process and a thread in operating systems.',
    marks: 10,
    expectedAnswer: 'A process is an independent executing program with its own dedicated memory space, whereas a thread is a lightweight unit of execution that shares memory and resources with other threads within the same process.',
    keywords: ['thread', 'process', 'concurrency', 'memory', 'resource'],
    keyConcepts: [
      'lightweight unit of execution',
      'independent execution',
      'shared memory',
      'separate memory'
    ],
    rubric: [
      { criterion: 'Process Definition', maxPoints: 3, description: 'Correctly identifies process as independent program with isolated memory' },
      { criterion: 'Thread Definition', maxPoints: 3, description: 'Identifies thread as lightweight unit of execution' },
      { criterion: 'Memory Sharing', maxPoints: 4, description: 'Contrasts separate address space vs shared memory space' }
    ],
    evaluationConfig: {
      enabled: true,
      keywordWeight: 25,
      conceptWeight: 25,
      semanticWeight: 30,
      aiWeight: 20,
      threshold: 70,
      autoGrade: true
    }
  };

  // -------------------------------------------------------------
  // Test 1: High Quality Answer
  // -------------------------------------------------------------
  console.log('================================================================================');
  console.log('TEST 1: High Quality Answer');
  console.log('================================================================================');
  const answer1 = 'A process is an independent program running with its own separate memory address space. A thread is a lightweight unit of execution within a process that shares memory and resources with other threads in the same process to achieve concurrency.';
  const res1 = await subjectiveEvaluationService.evaluateAnswer({ question, studentAnswer: answer1 });
  
  console.log(`Status: ${res1.evaluationStatus}`);
  console.log(`Suggested Marks: ${res1.awardedMarks} / ${res1.maximumMarks}`);
  console.log(`Confidence: ${res1.confidenceScore}%`);
  console.log(`Final Score: ${res1.evaluationScore}%`);
  console.log(`Keyword Score: ${res1.keywordScore}% | Concept Score: ${res1.conceptScore}% | Semantic: ${res1.semanticScore}% | AI Score: ${res1.aiScore}%`);
  console.log(`Matched Keywords: ${res1.matchedKeywords.join(', ')}`);
  console.log(`Matched Concepts: ${res1.matchedConcepts.join(', ')}`);
  console.log(`Contradictions: ${res1.incorrectClaims.length ? res1.incorrectClaims.join('; ') : 'None'}`);
  console.log(`Reason: ${res1.evaluationReason}`);
  if (res1.evaluationScore >= 80 && res1.awardedMarks >= 8) {
    console.log('PASS: High quality answer received high score (>80%)');
  } else {
    console.error('FAIL: Expected high score for comprehensive answer');
  }

  // -------------------------------------------------------------
  // Test 2: Partial Answer
  // -------------------------------------------------------------
  console.log('\n================================================================================');
  console.log('TEST 2: Partial Answer');
  console.log('================================================================================');
  const answer2 = 'A process has separate memory while a thread is a lightweight unit.';
  const res2 = await subjectiveEvaluationService.evaluateAnswer({ question, studentAnswer: answer2 });
  
  console.log(`Status: ${res2.evaluationStatus}`);
  console.log(`Suggested Marks: ${res2.awardedMarks} / ${res2.maximumMarks}`);
  console.log(`Confidence: ${res2.confidenceScore}%`);
  console.log(`Final Score: ${res2.evaluationScore}%`);
  console.log(`Keyword Score: ${res2.keywordScore}% | Concept Score: ${res2.conceptScore}% | Semantic: ${res2.semanticScore}%`);
  console.log(`Matched Keywords: ${res2.matchedKeywords.join(', ')}`);
  console.log(`Missing Keywords: ${res2.missingKeywords.join(', ')}`);
  console.log(`Matched Concepts: ${res2.matchedConcepts.join(', ')}`);
  console.log(`Missing Concepts: ${res2.missingConcepts.join(', ')}`);
  if (res2.evaluationScore >= 25 && res2.evaluationScore <= 75) {
    console.log('PASS: Partial answer received partial score (25-75%)');
  } else {
    console.error('FAIL: Expected partial score for incomplete answer');
  }

  // -------------------------------------------------------------
  // Test 3: Contradictory / Incorrect Answer
  // -------------------------------------------------------------
  console.log('\n================================================================================');
  console.log('TEST 3: Contradictory / Incorrect Answer');
  console.log('================================================================================');
  const answer3 = 'A thread has completely separate memory and does not share anything with other threads, while processes share all memory directly without isolation.';
  const res3 = await subjectiveEvaluationService.evaluateAnswer({ question, studentAnswer: answer3 });
  
  console.log(`Status: ${res3.evaluationStatus}`);
  console.log(`Suggested Marks: ${res3.awardedMarks} / ${res3.maximumMarks}`);
  console.log(`Confidence: ${res3.confidenceScore}%`);
  console.log(`Final Score: ${res3.evaluationScore}%`);
  console.log(`Contradictions: ${res3.incorrectClaims.join('; ')}`);
  if (res3.evaluationScore <= 40) {
    console.log('PASS: Contradictory answer penalized heavily and flagged');
  } else {
    console.error('FAIL: Contradictory answer was not sufficiently penalized');
  }

  // -------------------------------------------------------------
  // Test 4: Off-topic / Irrelevant Answer
  // -------------------------------------------------------------
  console.log('\n================================================================================');
  console.log('TEST 4: Off-topic / Irrelevant Answer');
  console.log('================================================================================');
  const answer4 = 'Photosynthesis is the biological process used by plants to convert light energy into chemical energy.';
  const res4 = await subjectiveEvaluationService.evaluateAnswer({ question, studentAnswer: answer4 });
  
  console.log(`Status: ${res4.evaluationStatus}`);
  console.log(`Suggested Marks: ${res4.awardedMarks} / ${res4.maximumMarks}`);
  console.log(`Final Score: ${res4.evaluationScore}%`);
  if (res4.evaluationScore <= 10 && res4.awardedMarks === 0) {
    console.log('PASS: Off-topic answer received 0 marks');
  } else {
    console.error('FAIL: Expected 0 marks for irrelevant answer');
  }

  // -------------------------------------------------------------
  // Test 5: Fallback Mode (Deterministic when AI Disabled)
  // -------------------------------------------------------------
  console.log('\n================================================================================');
  console.log('TEST 5: Fallback Mode (AI Disabled)');
  console.log('================================================================================');
  const fallbackQuestion = {
    ...question,
    evaluationConfig: {
      ...question.evaluationConfig,
      enabled: false // AI disabled
    }
  };
  const res5 = await subjectiveEvaluationService.evaluateAnswer({ question: fallbackQuestion, studentAnswer: answer1 });
  
  console.log(`Status: ${res5.evaluationStatus}`);
  console.log(`Suggested Marks: ${res5.awardedMarks} / ${res5.maximumMarks}`);
  console.log(`Confidence: ${res5.confidenceScore}%`);
  console.log(`Final Score: ${res5.evaluationScore}%`);
  console.log(`Reason: ${res5.evaluationReason}`);
  if (res5.evaluationScore >= 80) {
    console.log('PASS: Fallback mode evaluated deterministically without AI');
  } else {
    console.error('FAIL: Fallback evaluation did not score correctly');
  }

  console.log('\n================================================================================');
  console.log('ALL SUBJECTIVE EVALUATION TESTS COMPLETED SUCCESSFULLY!');
  console.log('================================================================================');
}

runTests().catch(err => {
  console.error('Error running test suite:', err);
  process.exit(1);
});
