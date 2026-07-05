import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { MakeCallRequest } from '@callstack/shared';
import { triggerCall, streamCallResult } from './lib/app-server-client.js';
import { sendSmsConfirmation } from './tools/send-sms-confirmation.js';

const server = new McpServer({ name: 'callstack', version: '0.1.0' });

const CALL_TYPES = [
  'booking',
  'cancellation',
  'inquiry',
  'complaint',
  'negotiation',
  'information_request',
  'reschedule',
  'order',
] as const;

server.tool(
  'start_call',
  'Trigger a real phone call toward a business objective. Returns almost ' +
    'immediately with {callId, dashboardUrl}. ALWAYS tell the user the ' +
    "dashboard URL right away, then call wait_for_call_result — don't wait " +
    'for the call to finish before sharing the link.',
  {
    phoneNumber: z.string().describe('E.164 phone number to dial, e.g. +15551234567'),
    businessName: z.string(),
    callType: z.enum(CALL_TYPES),
    objective: z.string().describe('What the call needs to accomplish'),
    constraints: z.array(z.string()).default([]),
    userName: z.string().describe('The client the AI is calling on behalf of'),
    context: z.string().optional(),
    calendarSlot: z
      .object({
        start: z.string().describe('ISO 8601'),
        end: z.string().optional(),
        label: z.string().optional(),
      })
      .optional()
      .describe('Pre-verified by the calendar connector before calling this tool'),
  },
  async (args) => {
    const request: MakeCallRequest = {
      phoneNumber: args.phoneNumber,
      businessName: args.businessName,
      callType: args.callType,
      objective: args.objective,
      constraints: args.constraints,
      userName: args.userName,
      context: args.context,
      calendarSlot: args.calendarSlot,
    };
    const result = await triggerCall(request);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
);

server.tool(
  'wait_for_call_result',
  'Blocks until the call finishes, returns the final outcome (transcript, ' +
    'receipt). Call this immediately after start_call, after the dashboard ' +
    'link has already been shared with the user.',
  {
    callId: z.string(),
  },
  async (args) => {
    const receipt = await streamCallResult(args.callId);
    return {
      content: [{ type: 'text', text: JSON.stringify(receipt) }],
    };
  },
);

server.tool(
  'send_sms_confirmation',
  'Send a confirmation SMS directly to a phone number.',
  {
    toNumber: z.string().describe('E.164 phone number, e.g. +15551234567'),
    message: z.string(),
  },
  async (args) => {
    const result = await sendSmsConfirmation(args.toNumber, args.message);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
