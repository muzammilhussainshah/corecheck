import type { PocCheck } from '@corecheck/shared';
import {
  buildView,
  type LocalPhoto,
  missingMandatory,
  outcomeOf,
  revokedIds,
} from '../src/model';

const check = (overrides: Partial<PocCheck> = {}): PocCheck => ({
  id: 'check-1',
  title: 'Daily check',
  plantLabel: 'EX-101',
  site: { id: 'site-1', name: 'Leeds' },
  status: 'open',
  submittedBy: null,
  submittedAt: null,
  answers: [],
  evidence: [],
  updatedAt: '2026-10-16T10:00:00.000Z',
  ...overrides,
});

const photo: LocalPhoto = {
  id: 'photo-1',
  checkId: 'check-1',
  questionKey: 'photo',
  uri: 'file:///photo.jpg',
  capturedAt: '2026-10-16T10:00:00.000Z',
  uploaded: false,
};

describe('offline check model', () => {
  it('shows unsynced local answers over the server copy', () => {
    const server = check({
      answers: [
        {
          questionKey: 'condition',
          value: 'pass',
          answeredBy: { id: 'u', name: 'U' },
          answeredAt: '2026-10-16T09:00:00.000Z',
        },
      ],
    });
    const view = buildView(
      server,
      [
        {
          checkId: 'check-1',
          questionKey: 'condition',
          value: 'fail',
          answeredAt: '2026-10-16T09:30:00.000Z',
        },
      ],
      [],
      false,
      null,
    );
    expect(view.answers.condition).toBe('fail');
    expect(view.pendingChanges).toBe(1);
  });

  it('blocks a submission until mandatory answers and a photo exist (CHK-006)', () => {
    expect(missingMandatory(buildView(check(), [], [], false, null))).toEqual([
      'Is the plant in safe working condition?',
      'Photo of the plant',
    ]);
    const complete = buildView(
      check(),
      [
        {
          checkId: 'check-1',
          questionKey: 'condition',
          value: 'pass',
          answeredAt: 'x',
        },
      ],
      [photo],
      false,
      null,
    );
    expect(missingMandatory(complete)).toEqual([]);
  });

  it('accepts a photo already on the server', () => {
    const withEvidence = check({
      evidence: [
        {
          id: 'e',
          questionKey: 'photo',
          uploadedBy: { id: 'u', name: 'U' },
          capturedAt: 'x',
          contentType: 'image/jpeg',
          sizeBytes: 1,
        },
      ],
    });
    const view = buildView(
      withEvidence,
      [
        {
          checkId: 'check-1',
          questionKey: 'condition',
          value: 'pass',
          answeredAt: 'x',
        },
      ],
      [],
      false,
      null,
    );
    expect(missingMandatory(view)).toEqual([]);
  });

  it('turns server rejections into a message for the user (MOB-007)', () => {
    expect(outcomeOf({ id: 'm', status: 'applied' })).toEqual({ kind: 'done' });
    expect(outcomeOf({ id: 'm', status: 'duplicate' })).toEqual({
      kind: 'done',
    });
    expect(
      outcomeOf({
        id: 'm',
        status: 'rejected',
        code: 'ALREADY_SUBMITTED',
        message: 'Already submitted by Alice.',
      }),
    ).toEqual({ kind: 'rejected', message: 'Already submitted by Alice.' });
  });

  it('finds checks the user can no longer see (MOB-AC-03)', () => {
    expect(revokedIds(['a', 'b', 'c'], [check({ id: 'b' })])).toEqual([
      'a',
      'c',
    ]);
  });
});
