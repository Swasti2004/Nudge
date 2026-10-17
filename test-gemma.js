/**
 * test-gemma.js - Diagnostic verification tool for Google Gemma 4 in Nudge Copilot
 * 
 * Usage:
 *   node test-gemma.js
 * or
 *   npm run verify:gemma
 * 
 * Tests whether:
 * 1. GEMMA_API_KEY is configured in the environment (without printing it).
 * 2. Which model ID is configured (GEMMA_MODEL or gemma-4-26b-a4b-it).
 * 3. Whether a real live Gemma 4 inference request succeeds.
 * 4. Whether the output is parsed and validated conforming to Nudge's schema.
 * 5. Reports safe, concise error category if failed.
 */
import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenAI } from '@google/genai';
import { buildGemmaSystemInstruction, validateGemmaOutput, formatInlineImagePart } from './ai.js';
import { todayIST } from './dates.js';

async function runGemmaDiagnostic() {
  console.log('======================================================');
  console.log('       Nudge Copilot - Gemma 4 Live Diagnostic        ');
  console.log('======================================================\n');

  const apiKey = process.env.GEMMA_API_KEY;
  const modelId = process.env.GEMMA_MODEL || 'gemma-4-26b-a4b-it';

  // 1. API Key check
  if (!apiKey) {
    console.log('[CONFIG] GEMMA_API_KEY: NOT CONFIGURED (Missing in environment)');
    console.log(`[CONFIG] Selected Model: ${modelId}`);
    console.log('\n[RESULT] Live Diagnostic: FAILED (MISSING_API_KEY)');
    console.log('--> Action required: Set GEMMA_API_KEY=your_key in c:\\nudge_app\\.env or your environment variables.');
    process.exit(1);
  }

  const maskedKey = apiKey.length > 8
    ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)} (length: ${apiKey.length})`
    : '***configured***';

  console.log(`[CONFIG] GEMMA_API_KEY: CONFIGURED [${maskedKey}]`);
  console.log(`[CONFIG] Selected Model: ${modelId}`);
  console.log(`[CONFIG] Current IST Date Grounding: ${todayIST()}`);
  console.log('\n[INFERENCE] Initiating genuine test inference call to Google GenAI with Gemma 4...');

  const startTime = Date.now();

  try {
    const ai = new GoogleGenAI({ apiKey });
    const systemInstruction = buildGemmaSystemInstruction(todayIST());

    const testPrompt = `Analyze the following student input:
<USER_TEXT>
Google Summer of Code 2027 internship application deadline is 24 November 2026.
</USER_TEXT>

Respond strictly with the single JSON object conforming to the schema.`;

    const response = await ai.models.generateContent({
      model: modelId,
      contents: [{ text: testPrompt }],
      config: {
        systemInstruction,
        temperature: 0.1
      }
    });

    const latencyMs = Date.now() - startTime;
    const rawText = response?.text;

    if (!rawText) {
      console.log(`\n[RESULT] Live Diagnostic: FAILED (EMPTY_RESPONSE) - Latency: ${latencyMs}ms`);
      console.log('--> Action: Gemma 4 returned an empty text payload.');
      process.exit(1);
    }

    // Parse and validate
    let parsed;
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.log(`\n[RESULT] Live Diagnostic: FAILED (PARSE_ERROR) - Latency: ${latencyMs}ms`);
      console.log(`--> Raw Response: ${rawText.substring(0, 200)}...`);
      console.log(`--> Parse Error: ${err.message}`);
      process.exit(1);
    }

    const validated = validateGemmaOutput(parsed, { title: 'Test Opportunity' });

    console.log(`[INFERENCE] Request completed successfully in ${latencyMs}ms.`);
    console.log(`[VALIDATION] Output Schema Validated: YES`);
    console.log(`[VALIDATION] Extracted Intent: "${validated.intent}"`);
    if (validated.items.length > 0) {
      const item = validated.items[0];
      console.log(`[VALIDATION] Title: "${item.title}"`);
      console.log(`[VALIDATION] Organization: "${item.org}"`);
      console.log(`[VALIDATION] Deadline: "${item.deadline}" (Type: ${item.deadline_type})`);
      console.log(`[VALIDATION] Evidence: "${item.evidence}"`);
    }

    console.log('\n======================================================');
    console.log('  SUCCESS: Genuine Google Gemma 4 Inference Verified! ');
    console.log('======================================================');
    process.exit(0);

  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const msg = err.message || '';
    let category = 'API_ERROR';

    if (/401|403|unauthorized|invalid api key|api_key/i.test(msg)) {
      category = 'AUTH_ERROR';
    } else if (/429|quota|rate limit|resource exhausted/i.test(msg)) {
      category = 'RATE_LIMIT';
    } else if (/timeout|timed out|abort/i.test(msg)) {
      category = 'TIMEOUT';
    } else if (/enotfound|econnrefused|network/i.test(msg)) {
      category = 'NETWORK_ERROR';
    }

    console.log(`\n[RESULT] Live Diagnostic: FAILED (${category}) - Latency: ${latencyMs}ms`);
    console.log(`--> Reason: ${msg.split('\n')[0]}`);
    process.exit(1);
  }
}

runGemmaDiagnostic();
