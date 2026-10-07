import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { store, normalize } from '../src/store.js';
import {
  startPractice, endPractice, heartbeat, running, awayStop, countTimeAway, autoStart, practicedMs,
  practicedByDay, fmtDuration, fmtClock, AWAY_MS,
} from '../src/practicetime.js';
import { setState } from './helpers.js';

const MIN = 60000;
const at = (h, m = 0, day = 6) => new Date(2026, 9, day, h, m).getTime(); // Oct `day`, 2026, local

// The app open from `from` to `to`: heartbeats every half minute.
const open = (from, to) => { for (let t = from; t <= to; t += MIN / 2) heartbeat(t); };

beforeEach(() => setState([]));

describe('practice timer', () => {
  it('runs from start to end, on the practice day it started', () => {
    startPractice(at(20));
    expect(running().date).toBe('2026-10-06');
    expect(practicedMs('2026-10-06', at(20, 25))).toBe(25 * MIN);
    endPractice(at(20, 40));
    expect(running()).toBe(null);
    expect(practicedMs('2026-10-06', at(23))).toBe(40 * MIN);
  });

  it('a late session after midnight belongs to the evening before', () => {
    startPractice(at(0, 30, 7));
    endPractice(at(1, 0, 7));
    expect(practicedByDay().get('2026-10-06')).toBe(30 * MIN);
  });

  it('keeps going through a short time away, counting it', () => {
    startPractice(at(20));
    open(at(20), at(20, 10)); // hidden: playing along in another app
    expect(heartbeat(at(20, 20))).toBe(null); // back after 10 minutes
    expect(running()).not.toBe(null);
    expect(practicedMs('2026-10-06', at(20, 20))).toBe(20 * MIN);
  });

  it('stops when the app was last seen if it was away a while, and can count that time after all', () => {
    startPractice(at(20));
    open(at(20), at(20, 30)); // then the app is hidden
    const back = at(20, 30) + AWAY_MS + MIN;
    expect(heartbeat(back)).toBe('stopped');
    expect(running()).toBe(null);
    expect(practicedMs('2026-10-06', back)).toBe(30 * MIN);
    expect(awayStop(back)).not.toBe(null);
    countTimeAway(back);
    expect(running()).not.toBe(null);
    expect(awayStop(back)).toBe(null);
    expect(practicedMs('2026-10-06', back)).toBe(back - at(20));
  });

  it('only offers to count the time away on the same day', () => {
    startPractice(at(20));
    open(at(20), at(21));
    expect(heartbeat(at(9, 0, 7))).toBe('stopped');
    expect(awayStop(at(9, 0, 7))).toBe(null);
    expect(practicedByDay().get('2026-10-06')).toBe(60 * MIN);
  });

  it('marking something played starts it, unless it ran or was stopped already today', () => {
    expect(autoStart(at(19))).not.toBe(null);
    endPractice(at(19, 30));
    expect(autoStart(at(20))).toBe(null); // ended on purpose: stays ended
    expect(autoStart(at(19, 0, 7))).not.toBe(null); // a new day
  });

  it('sessions survive saving and loading, and bad ones are dropped', () => {
    startPractice(at(20));
    store.state.sessions.push({ date: 'nope', start: 1 }, { id: 'x', date: '2026-10-05', start: 5, end: 1 });
    const s = normalize(JSON.parse(JSON.stringify(store.state)));
    expect(s.sessions).toHaveLength(2);
    expect(s.sessions[1].end).toBe(5); // never before its start
    expect(s.timing).toBe(s.sessions[0].id);
    expect(normalize({ ...s, timing: 'gone' }).timing).toBe(null);
  });

  it('formats times', () => {
    expect(fmtDuration(20000)).toBe('<1 min');
    expect(fmtDuration(45 * MIN)).toBe('45 min');
    expect(fmtDuration(65 * MIN)).toBe('1 h 5 min');
    expect(fmtDuration(120 * MIN)).toBe('2 h');
    expect(fmtClock(245000)).toBe('4:05');
    expect(fmtClock(3729000)).toBe('1:02:09');
  });
});
