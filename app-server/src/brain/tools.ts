import type Groq from 'groq-sdk';

type ToolDef = Groq.Chat.Completions.ChatCompletionTool;

// §6.2 — every tool requires spokenReply. Groq returns an empty
// message.content whenever a tool call is made (§7 #4 / §6.3) so the spoken
// text MUST travel inside the tool call args, on every single tool.
const spokenReply = {
  type: 'string' as const,
  description: 'What to say out loud this turn, one short sentence, always include.',
};

export const BRAIN_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'classify_answer',
      description: 'First turn only: classify who/what answered.',
      parameters: {
        type: 'object',
        properties: {
          classification: {
            type: 'string',
            enum: ['human', 'menu', 'voicemail'],
          },
          confidence: { type: 'number', description: '0-1' },
          spokenReply,
        },
        required: ['classification', 'confidence', 'spokenReply'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_dtmf',
      description: 'Press one digit on an automated phone menu.',
      parameters: {
        type: 'object',
        properties: {
          digit: { type: 'string', description: 'One of 0-9, *, #' },
          spokenReply,
        },
        required: ['digit', 'spokenReply'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_slot_availability',
      description: 'Compare a proposed time against the pre-confirmed calendar slot.',
      parameters: {
        type: 'object',
        properties: {
          proposedTime: { type: 'string' },
          spokenReply,
        },
        required: ['proposedTime', 'spokenReply'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirm_booking',
      description: 'Call once the goal is met.',
      parameters: {
        type: 'object',
        properties: {
          confirmedDetail: { type: 'string' },
          spokenReply,
        },
        required: ['confirmedDetail', 'spokenReply'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_human',
      description: 'Escalate to the human operator when unable to decide within constraints.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          spokenReply,
        },
        required: ['question', 'spokenReply'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'end_call',
      description: 'End the call.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            enum: ['goal_met', 'voicemail_left', 'nothing_more_to_do'],
          },
          spokenReply,
        },
        required: ['reason', 'spokenReply'],
      },
    },
  },
];

// T5 (§14, CRITICAL) — guards the worst live-call failure mode: a tool
// shipped without spokenReply means silent dead air on every turn that
// calls it. Runs at module load, not just in tests, so a bad edit fails
// immediately in dev rather than surfacing live on a call.
for (const tool of BRAIN_TOOLS) {
  const props = tool.function.parameters?.properties as
    | Record<string, unknown>
    | undefined;
  const required = tool.function.parameters?.required as string[] | undefined;
  if (!props?.spokenReply || !required?.includes('spokenReply')) {
    throw new Error(
      `Tool "${tool.function.name}" is missing required spokenReply (§6.2 gotcha)`,
    );
  }
}
