import * as today from './today.js';
import * as items from './items.js';
import * as diary from './diary.js';
import * as settings from './settings.js';
import type { Command } from './core.js';

// The registry: every command, from each area's module (anything they export that's a command is
// in it). The assistant has a tool for each one with a description (see assistant/tools.ts), so a
// new command is one for the assistant too.

export * from './today.js';
export * from './items.js';
export * from './diary.js';
export * from './settings.js';
export { exec, undo, canUndo, invalidateUndo, beginGroup, endGroup, CommandError, type Command, type UndoEntry, type Done } from './core.js';

const isCommand = (x: unknown): x is Command => !!x && typeof x === 'object' && 'name' in x && 'fields' in x && 'run' in x;
export const COMMANDS: Command[] = [today, items, diary, settings].flatMap((m) => Object.values(m).filter(isCommand) as Command[]);
