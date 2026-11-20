import type { LlmTool } from 'agora-agents';

// Tool definitions sent to Agora (llm.tools). Agora's cloud calls these HTTPS endpoints
// synchronously during the conversation. The session id and a shared secret travel as
// template variables, so the LLM never sees or handles them.

function tool(
  name: string,
  description: string,
  properties: Record<string, { type: string; description: string; enum?: string[] }>,
  required: string[],
  baseUrl: string,
): LlmTool {
  // Only required args go in the body: Agora cannot render a placeholder for an optional
  // argument the LLM left out, and then the call never reaches us. So every arg is required.
  const body: Record<string, string> = {};
  for (const key of required) body[key] = `{{args.${key}}}`;
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required },
    },
    execution: { mode: 'sync' },
    server: {
      method: 'POST',
      url: `${baseUrl}/api/tools/${name}`,
      headers: {
        'X-Session-Id': '{{template_variables.session_id}}',
        'X-Tool-Secret': '{{template_variables.tool_secret}}',
      },
      body,
      timeout_ms: 8000,
    },
  } as LlmTool;
}

export function buildTools(baseUrl: string): LlmTool[] {
  return [
    tool(
      'getCurrentQuestion',
      'Get the question to ask next. Only use this when you are unsure what to ask; after an answer always use submitAnswer instead.',
      {},
      [],
      baseUrl,
    ),
    tool(
      'submitAnswer',
      "Submit the farmer's answer to the current question. Call this after EVERY answer the farmer gives, with their exact words.",
      { raw_answer: { type: 'string', description: "The farmer's exact words, untranslated." } },
      ['raw_answer'],
      baseUrl,
    ),
    tool(
      'submitInterpretation',
      'Only after a needs_interpretation result: tell the engine what you believe the farmer meant.',
      {
        raw_answer: { type: 'string', description: "The farmer's exact words, untranslated." },
        interpreted_value: {
          type: 'string',
          description: 'The allowed option, date (YYYY-MM-DD), number or yes/no you believe the farmer meant.',
        },
      },
      ['raw_answer', 'interpreted_value'],
      baseUrl,
    ),
    tool(
      'correctAnswer',
      'Change an earlier answer when the farmer says something was wrong.',
      {
        question_code: {
          type: 'string',
          description: 'Which answer to change.',
          enum: [
            'policy_ref', 'crop_affected', 'cause_of_loss', 'crop_stage', 'loss_date', 'harvest_date',
            'affected_area', 'loss_percent', 'confirm_sms',
          ],
        },
        raw_answer: { type: 'string', description: "The farmer's new answer, exact words." },
      },
      ['question_code', 'raw_answer'],
      baseUrl,
    ),
    tool(
      'setLanguage',
      'Switch the conversation language when the farmer starts speaking a different language.',
      { language: { type: 'string', description: 'New language.', enum: ['hi', 'kn', 'en'] } },
      ['language'],
      baseUrl,
    ),
    tool(
      'fileClaim',
      'Register the claim. Only call after the farmer said yes to the final summary.',
      {
        confirmed: { type: 'boolean', description: 'True only if the farmer clearly approved.' },
        farmer_words: { type: 'string', description: "The farmer's exact words of approval." },
      },
      ['confirmed', 'farmer_words'],
      baseUrl,
    ),
    tool(
      'getClaimStatus',
      'Look up an existing claim when a farmer asks about a claim they filed earlier.',
      { claim_id_or_mobile: { type: 'string', description: 'Claim number (e.g. FBS-260001) or mobile number.' } },
      ['claim_id_or_mobile'],
      baseUrl,
    ),
  ];
}
