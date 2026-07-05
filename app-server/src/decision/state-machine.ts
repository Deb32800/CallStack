import type { CallStateMachine } from '@callstack/shared';

export type CallEvent =
  | { type: 'classified'; classification: 'human' | 'menu' | 'voicemail' }
  | { type: 'unclassifiable' }
  | { type: 'dtmf_dead_end' }
  | { type: 'low_confidence_escalation' }
  | { type: 'human_answered' }
  | { type: 'interrupt' }
  | { type: 'goal_met' }
  | { type: 'call_dropped' }
  | { type: 'redial_resumed' }
  | { type: 'end' };

/** Pure state transition — no I/O, unit-testable (§8, §14 T4). */
export function transition(
  current: CallStateMachine,
  event: CallEvent,
): CallStateMachine {
  switch (event.type) {
    case 'classified':
      if (event.classification === 'voicemail') return 'VOICEMAIL';
      if (event.classification === 'menu') return 'MENU';
      return 'CONVERSING';
    case 'unclassifiable':
      return 'CLASSIFY';
    case 'dtmf_dead_end':
      return 'ASK_HUMAN';
    case 'low_confidence_escalation':
      return 'ASK_HUMAN';
    case 'human_answered':
      return 'CONVERSING';
    case 'interrupt':
      return 'LISTENING';
    case 'goal_met':
      return 'END';
    case 'call_dropped':
      return 'DROP_RECOVERY';
    case 'redial_resumed':
      return 'CONVERSING';
    case 'end':
      return 'END';
    default:
      return current;
  }
}
