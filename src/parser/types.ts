import type { ISODate, Priority, RecurrenceRule } from '../domain/types';

export type TokenKind = 'date' | 'recurrence' | 'project' | 'person' | 'priority' | 'estimate' | 'tag';

/** Fragmento del texto reconocido. Los offsets son relativos al texto completo. */
export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  text: string;
}

export interface ParsedTask {
  title: string;
  /** Fragmento original de esta tarea (se guarda en raw_input). */
  raw_input: string;
  due_date: ISODate | null;
  /** id null = proyecto nuevo que habrá que crear. */
  project: { id: string | null; name: string } | null;
  people: string[];
  tags: string[];
  priority: Priority | null;
  estimated_minutes: number | null;
  recurrence: RecurrenceRule | null;
  tokens: Token[];
}

export interface CaptureContext {
  today: ISODate;
  projects: { id: string; name: string }[];
  people: string[];
  /** Claves de tokens (ver tokenKey) que el usuario ha descartado: se tratan como texto normal. */
  ignore?: string[];
}

/** Interfaz estable: se podrá sustituir por un parser con IA sin tocar la UI. */
export type ParseCapture = (text: string, ctx: CaptureContext) => ParsedTask[];

export const tokenKey = (t: Pick<Token, 'kind' | 'text'>) => `${t.kind}:${t.text.toLowerCase()}`;
