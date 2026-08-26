import { api } from './api/api';
import type { Bill } from './types';


interface AIResponse {
  success: boolean;
  data?: string;
  error?: string;
}

interface QuestionAnswer {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  sources?: string[];
}

// AI generation now runs through the backend proxy (/api/ai/generate) so the
// provider API key stays server-side and is never embedded in client code.
async function callBackendAI(params: {
  system?: string;
  prompt: string;
  model?: string;
  maxCompletionTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    const response = await api.post<{ content: string }>('/api/ai/generate', params);
    return { success: true, content: response.content };
  } catch (error) {
    console.log('Backend AI generation error:', error);
    return { success: false, error: 'Failed to generate content' };
  }
}


/**
 * Generate a plain English explanation of a bill
 */
export async function generateBillExplanation(bill: Bill): Promise<AIResponse> {
  const result = await callBackendAI({
    system: `You are a civic education expert who explains legislation to everyday citizens.
Your goal is to make complex legal language accessible without being condescending.
Be balanced and non-partisan. Focus on facts and practical implications.
Keep explanations concise but thorough - around 150-200 words.`,
    prompt: `Please explain this bill in plain English that a high school student could understand:

Title: ${bill.title}
Short Title: ${bill.shortTitle}
Category: ${bill.category}
Status: ${bill.status}
${bill.sponsor ? `Sponsor: ${bill.sponsor.name} (${bill.sponsor.party}-${bill.sponsor.state})` : ''}

Full Text Summary:
${bill.fullText.substring(0, 2000)}

Focus on:
1. What this bill actually does
2. Who it affects
3. Why it matters`,
    maxCompletionTokens: 500,
    temperature: 1.0,
  });

  if (!result.success) {
    return { success: false, error: 'Failed to generate explanation' };
  }

  return { success: true, data: result.content };
}

/**
 * Analyze a bill for pros, cons, and impacted groups
 */
/*
 * analyzeBillImpact() and generateDebatePoints() ARE GONE, AND NOT REPLACED.
 *
 * Both generated the case for and against a bill, per reader, in the reader's
 * own browser or device, at temperature 1, cached for thirty minutes there and
 * nowhere else. So two people looking at the same law got different concerns
 * about it, and one person looking twice in a day got different concerns from
 * themselves.
 *
 * Worse than the inconsistency was the input. analyzeBillImpact truncated to
 * `fullText.substring(0, 3000)` — the first three thousand characters of a bill
 * are its title, its findings and its definitions, so the operative provisions
 * were mostly not in the prompt. generateDebatePoints was fed
 * `bill.simplifiedText`, which is the brief's own summary: arguments about a
 * summary, twice removed from the text they claimed to describe.
 *
 * backend/src/services/citizen-brief.ts already writes argumentFor and
 * argumentAgainst from the COMPLETE official text, stores them on the record,
 * and serves the same text to everybody, once per version of the law. Three
 * disagreeing answers to "what does this do" is worse than one, and that is the
 * one that survives.
 */

export async function askAboutBill(bill: Bill, question: string): Promise<{ success: boolean; data?: QuestionAnswer; error?: string }> {
  const result = await callBackendAI({
    system: `You are a helpful civic assistant answering questions about legislation.
Be accurate, balanced, and acknowledge uncertainty when appropriate.
Keep answers concise (100-150 words) and accessible to general audiences.
Return JSON: {"answer": "your response", "confidence": "high|medium|low"}`,
    prompt: `Bill: ${bill.shortTitle}
Title: ${bill.title}
Category: ${bill.category}
Text excerpt: ${bill.fullText.substring(0, 1500)}

User question: ${question}

Provide a helpful, accurate answer.`,
    maxCompletionTokens: 300,
    temperature: 1.0,
    jsonMode: true,
  });

  if (!result.success || !result.content) {
    return { success: false, error: 'Failed to get answer' };
  }

  try {
    const parsed = JSON.parse(result.content) as QuestionAnswer;
    return { success: true, data: parsed };
  } catch {
    return {
      success: true,
      data: { answer: result.content, confidence: 'medium' },
    };
  }
}

/**
 * Generate a debate-style comparison of arguments for/against a bill
 */
/**
 * Check if AI services are available.
 * Availability is determined server-side (the provider key lives in the backend only).
 */
export async function getAIAvailability(): Promise<{ gemini: boolean; openai: boolean }> {
  try {
    const response = await api.get<{ openai: boolean }>('/api/ai/availability');
    return { gemini: false, openai: response.openai };
  } catch {
    return { gemini: false, openai: false };
  }
}

/*
 * REMOVED ON PURPOSE: generateCitizensBrief / generateScotusBrief /
 * generateExecutiveOrderBrief / convertToPost / generateQuickPreview.
 *
 * Those wrote briefs on the device from a 3,000-8,000 character slice of text —
 * and when the official text could not be fetched, they instructed the model to
 * write the brief from its own knowledge. That produced confident, inaccurate
 * summaries.
 *
 * Every Citizen's Brief now comes from the server, which pulls the ENTIRE official
 * text, reads all of it, fact-checks the result, and stores it on the master
 * reference. If no source has the text, there is no brief and the app says so.
 * See backend/src/services/reference-content.ts and the useLibraryBrief hook.
 */
