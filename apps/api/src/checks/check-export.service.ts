import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  CHECK_STATUS_LABELS,
  type CheckDetail,
  DEFECT_SEVERITY_LABELS,
  describeCondition,
  PLANT_STATUS_LABELS,
  questionVisible,
  TEMPLATE_PURPOSE_LABELS,
} from '@corecheck/shared';
import type { CustomerAuth } from '../auth/auth-context.js';
import { answerText } from '../common/answers.js';
import { Clock } from '../common/clock.js';

const when = (iso: string | null, timeZone: string): string =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(iso))
    : '—';

/**
 * The exported record of one check (checks.export, EVD-003): what was
 * asked, every answer with who gave it and when, evidence, changes made
 * after submission with their reasons, the review, Defects raised and all
 * contributors.
 */
@Injectable()
export class CheckExportService {
  constructor(private readonly clock: Clock) {}

  async pdf(
    auth: CustomerAuth,
    check: CheckDetail,
  ): Promise<{ body: Buffer; filename: string; contentType: string }> {
    const tz = auth.org.timeZone;
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve) => doc.on('end', resolve));

    const heading = (text: string) => {
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).fillColor('#111');
      doc.text(text);
      doc.moveDown(0.2).font('Helvetica').fontSize(9).fillColor('#222');
    };
    const row = (label: string, value: string) => {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    };

    doc.font('Helvetica-Bold').fontSize(16).text(`${check.ref} — ${check.template.name}`);
    doc.font('Helvetica').fontSize(9).fillColor('#555');
    doc.text(`${auth.org.name} · exported ${when(this.clock.now().toISOString(), tz)}`);
    doc.fillColor('#222');

    heading('Check');
    row('Plant', `${check.plant.assetId} ${check.plant.name} (${PLANT_STATUS_LABELS[check.plant.status]})`);
    row('Site', check.plant.site.name);
    row(
      'Template',
      `${check.template.name}, version ${check.template.version} (${TEMPLATE_PURPOSE_LABELS[check.template.purpose]})`,
    );
    row('Status', CHECK_STATUS_LABELS[check.displayStatus]);
    if (check.schedule) row('Schedule', check.schedule.name);
    if (check.defect) row('Verifies', check.defect.ref);
    row('Due', check.dueOn ?? 'No due date');
    const assignee = [
      check.assignee.user?.name,
      check.assignee.team && `team ${check.assignee.team.name}`,
      check.assignee.discipline && `discipline ${check.assignee.discipline.name}`,
    ]
      .filter(Boolean)
      .join(', ');
    row('Assigned to', assignee || '—');
    row('Created', `${when(check.createdAt, tz)}${check.createdBy ? ` by ${check.createdBy}` : ' by schedule'}`);
    if (check.submittedAt)
      row('Submitted', `${when(check.submittedAt, tz)} by ${check.submittedBy}`);
    if (check.reviewedAt)
      row(
        'Reviewed',
        `${when(check.reviewedAt, tz)} by ${check.reviewedBy}${check.reviewComment ? ` — ${check.reviewComment}` : ''}`,
      );
    if (check.reviewOverrideReason)
      row('Separation override', check.reviewOverrideReason);
    if (check.cancelledAt)
      row('Cancelled', `${when(check.cancelledAt, tz)} by ${check.cancelledBy ?? 'schedule'} — ${check.cancelReason}`);

    heading('Answers');
    const value = (id: string) => check.answers.find((a) => a.questionId === id)?.value;
    check.questions.forEach((question, index) => {
      const asked = questionVisible(question, check.questions, value);
      const answer = check.answers.find((a) => a.questionId === question.id);
      const files = check.evidence.filter((e) => e.questionId === question.id);
      doc.font('Helvetica-Bold').text(`${index + 1}. ${question.text}`);
      doc.font('Helvetica');
      if (question.showIf)
        doc.fillColor('#666').text(describeCondition(question.showIf, check.questions)).fillColor('#222');
      if (!asked) {
        doc.fillColor('#666').text('Not asked').fillColor('#222');
      } else if (question.type === 'photo') {
        doc.text(files.length ? `${files.length} file(s)` : 'No files');
      } else if (answer) {
        doc.text(`${answerText(answer.value)} — ${answer.answeredBy}, ${when(answer.answeredAt, tz)}`);
      } else {
        doc.text('No answer');
      }
      if (answer?.comment) doc.text(`Comment: ${answer.comment}`);
      for (const file of files)
        doc.text(`File: ${file.fileName} — ${file.uploadedBy}, ${when(file.uploadedAt, tz)}`);
      doc.moveDown(0.3);
    });

    const edits = check.changes.filter((change) => change.afterSubmission);
    if (edits.length) {
      heading('Changes after submission');
      for (const edit of edits) {
        const question = check.questions.find((q) => q.id === edit.questionId);
        doc.text(
          `${question?.text ?? edit.questionId}: ${answerText(edit.previousValue)} → ${answerText(edit.value)} by ${edit.changedBy}, ${when(edit.changedAt, tz)}. Reason: ${edit.reason}`,
        );
      }
    }

    if (check.defectsRaised.length) {
      heading('Defects raised');
      for (const defect of check.defectsRaised) {
        const question = check.questions.find((q) => q.id === defect.questionId);
        doc.text(`${defect.ref} (${DEFECT_SEVERITY_LABELS[defect.severity]}): ${question?.text ?? ''}`);
      }
    }

    heading('Contributors');
    for (const contributor of check.contributors) {
      const questions = contributor.questionIds
        .map((id) => check.questions.findIndex((q) => q.id === id) + 1)
        .filter((n) => n > 0)
        .map((n) => `Q${n}`);
      doc.text(`${contributor.name}: ${questions.join(', ') || '—'}`);
    }
    if (check.contributors.length === 0) doc.text('No answers yet.');

    doc.end();
    await done;
    return {
      body: Buffer.concat(chunks),
      filename: `${check.ref}-${check.plant.assetId}.pdf`,
      contentType: 'application/pdf',
    };
  }
}
