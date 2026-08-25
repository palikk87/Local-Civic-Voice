import { api } from '@/lib/api';
import type { Bill } from './types';


interface AIResponse {
  success: boolean;
  data?: string;
  error?: string;
}

interface BillAnalysis {
  summary: string;
  pros: string[];
  cons: string[];
  impactedGroups: string[];
  keyPoints: string[];
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
export async function analyzeBillImpact(bill: Bill): Promise<{ success: boolean; data?: BillAnalysis; error?: string }> {
  const result = await callBackendAI({
    system: `You are a non-partisan policy analyst. Analyze legislation objectively, presenting both sides fairly.
Return your analysis as valid JSON with this exact structure:
{
  "summary": "2-3 sentence overview",
  "pros": ["benefit 1", "benefit 2", "benefit 3"],
  "cons": ["concern 1", "concern 2", "concern 3"],
  "impactedGroups": ["group 1", "group 2"],
  "keyPoints": ["point 1", "point 2", "point 3"]
}`,
    prompt: `Analyze this legislation:

Title: ${bill.title}
Category: ${bill.category}
Chamber: ${bill.chamber}
Status: ${bill.status}

Text:
${bill.fullText.substring(0, 3000)}

Provide a balanced analysis with pros, cons, impacted groups, and key points.`,
    maxCompletionTokens: 800,
    temperature: 1,
  });

  if (!result.success || !result.content) {
    return { success: false, error: 'Failed to analyze bill' };
  }

  const content = result.content;

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]) as BillAnalysis;
      return { success: true, data: analysis };
    }
  } catch {
    return {
      success: true,
      data: {
        summary: content.substring(0, 200),
        pros: ['Analysis available', 'Review full text for details'],
        cons: ['Consider multiple perspectives'],
        impactedGroups: ['Various stakeholders'],
        keyPoints: ['See full analysis'],
      },
    };
  }

  return { success: false, error: 'Could not parse analysis' };
}

/**
 * Answer a user's question about a specific bill
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
export async function generateDebatePoints(bill: Bill): Promise<AIResponse> {
  const result = await callBackendAI({
    system: `You are a debate moderator presenting the strongest arguments from both sides of a legislative issue.
Be fair, balanced, and present each side's best arguments without taking a position.
Format: Start with "FOR:" followed by 3 bullet points, then "AGAINST:" with 3 bullet points.`,
    prompt: `Present the strongest arguments for and against this bill:

${bill.shortTitle}: ${bill.title}

${bill.simplifiedText}

Category: ${bill.category}
Current Status: ${bill.status}`,
    maxCompletionTokens: 600,
    temperature: 1,
  });

  if (!result.success) {
    return { success: false, error: 'Failed to generate debate points' };
  }

  return { success: true, data: result.content };
}

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
 * Those wrote briefs in the browser from a 3,000-8,000 character slice of text —
 * and when the official text could not be fetched (the browser is blocked by CORS
 * on congress.gov and CourtListener), they instructed the model to write the brief
 * from its own knowledge. That produced confident, inaccurate summaries.
 *
 * Every Citizen's Brief now comes from the server, which pulls the ENTIRE official
 * text, reads all of it, fact-checks the result, and stores it on the master
 * reference. If no source has the text, there is no brief and the app says so.
 * See backend/src/services/reference-content.ts and the useLibraryBrief hook.
 */
