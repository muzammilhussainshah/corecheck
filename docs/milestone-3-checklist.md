# Milestone 3 — Checks, Schedules aur Defects: live checklist

Har kaam mukammal hone par yahan `[x]` lagta hai. `🔄` = abhi chal raha hai.
Branch: `milestone3`. Scope: FRD sections 10, 11, 12, 13 (+ 21 agar mobile M3 mein ho).

**Abhi:** Milestone 3 ka code mukammal ✅ (Phase 1–4 + 6). Baqi: mobile (Phase 5, faisla aap ka) aur staging deploy.

---

## Faisle baqi (shuru karne se pehle / dauran)

- [ ] ITDR Milestone 3 ka scope paste karke is list se milana (ITDR nahi mila; FRD 10–13 se banaya)
- [ ] Mobile offline checks (Phase 5) M3 mein hain ya alag milestone mein — abhi nahi bana
- [x] Notifications: abhi sirf in-app (bell); email/push notifications milestone mein — records tayyar hain
- [x] Reception alag rakha; template engine (single-selection, follow-up, defect trigger) dono mein chalta hai

---

## Phase 1 — Template engine (FRD 10)

- [x] Database: `check_templates.purpose` mein operational, technical, maintenance, defect_verification (TMP-007)
- [x] Template kahan lagega: plant types/categories, disciplines, teams/users (TMP-008)
- [x] Naya sawal: single-selection (options ke saath) (TMP-010)
- [x] Naya sawal: meter requirement (kaunsa meter type) (TMP-008, TMP-010)
- [x] Sawal setting: defect trigger + trigger jawab + severity (Minor/Major/Critical) (TMP-009)
- [x] Sawal setting: conditional follow-up sawal (TMP-009)
- [x] Template duplicate (TMP-001)
- [x] Publish par choice: sirf aage ke checks ya purane unstarted checks bhi (TMP-005)
- [x] Started/submitted/completed check kabhi rewrite na ho (TMP-006, TMP-AC-03)
- [x] Draft template se production check na bane (TMP-002, TMP-AC-01)
- [x] Completion aur approval alag; Major/Critical defect verification par separation default ON (TMP-011)
- [x] Permissions: sirf Admin (`templates.manage`, `templates.configure_questions`) server par enforce
- [x] Web: Manage › Templates builder (purpose, eligibility, naye sawal, defect trigger, follow-up, duplicate, publish choice)
- [x] Tests: templates (versions reproducible, draft block, apply-to-unstarted, permissions, tenant isolation)

## Phase 2 — Check schedules (FRD 11)

- [x] Database: schedule rules (template + plant, frequency, interval, start date, approval zaroori, paused) RLS ke saath
- [x] Recurrence: daily, weekly, monthly, quarterly, annual, custom (SCH-002)
- [x] Alag start date (SCH-003)
- [x] Rule banana / badalna / pause sirf Admin (`schedules.manage_rules`) (SCH-001, SCH-005)
- [x] Generator job (har ghante): checks banaye, weekly check hafte ke shuru mein org time zone mein nazar aaye (SCH-006)
- [x] Agla check asal completion date se (SCH-009)
- [x] Due date guzri aur submit nahi → Overdue (SCH-007)
- [x] Overdue par responsible user/team + Supervisor/Manager/Admin ko notify (SCH-008; channel upar ke faisle ke mutabiq)
- [x] Plant Restricted/Offline → schedule pause, history mehfooz; return to service ki date se dobara (SCH-010, SCH-AC-02/03)
- [x] Approval step sirf jab schedule par laga ho (SCH-011)
- [x] Ek check ko reschedule / reassign, rule badle baghair (SCH-004, SCH-AC-04)
- [x] Overdue manage karna scope ke andar (`schedules.manage_overdue`)
- [x] Web: Manage › Schedules screen
- [x] Web: Checks list (Upcoming / Due / Overdue filters, reschedule, reassign)
- [x] Tests: schedules (intervals, completion date, pause/resume, reschedule, time zone)

## Phase 3 — Checks bharna (FRD 12)

- [x] Database: checks, answers, evidence, contributors, submissions (RLS ke saath)
- [x] Check apna plant, template version, schedule, assignees, due date, status, answers, evidence, meter readings, contributors rakhe (CHK-002)
- [x] Check kise nazar aaye: assigned user, team/discipline, scope (CHK-001)
- [x] Har sawal par kis ne jawab diya / badla, permanently (CHK-004)
- [x] Ek check par kai log saath kaam kar sakein, attribution na khoye (CHK-003, CHK-AC-02)
- [x] Draft save aur resume (CHK-005)
- [x] Mandatory sawal / evidence baqi → submit block, sawal highlight (CHK-006, CHK-AC-01)
- [x] First valid submission wins; doosri overwrite na kare (CHK-007, CHK-AC-03)
- [x] Submit ke baad read-only (CHK-008)
- [x] Review: approve / reject / return (Supervisor; Manager/Admin higher-level) (CHK-009)
- [x] Reopen; submitted edit sirf original value + reason + editor + waqt ke saath (CHK-010, CHK-AC-04)
- [x] Cancel / void sirf authorised user + reason (CHK-011)
- [x] Evidence: comments, photos, files, measurements, meter readings; uploader + waqt + sawal se rishta (EVD-001/002)
- [x] Meter reading sawal → `meter_readings` (source: check)
- [x] Offline trigger wala sawal fail → plant Restricted/Offline
- [x] GPS / location nahi (EVD-004)
- [x] Web: My Checks
- [x] Web: Check screen (bharna, photos, draft, submit, review)
- [x] Web: Plant profile ka Checks tab
- [x] Check detail + PDF export, saare contributors aur unke sawal (EVD-003)
- [x] Tests: checks (mandatory block, do contributors, concurrent submit, edit-after-submit, cancel, scope)

## Phase 4 — Defects aur return to service (FRD 13)

- [x] Database: defects, defect work/evidence, verification, approvals (RLS ke saath)
- [x] Defect sirf trigger wale jawab se bane; manual standalone nahi (DEF-002/003, DEF-AC-01)
- [x] Reception failure se bhi defect bane (M2 ka open item)
- [x] Defect rakhe: plant, check, sawal, fail jawab, evidence, creator, waqt, severity, status, assignees, corrective action, verification, audit (DEF-004)
- [x] Severity Minor / Major / Critical; status Open / In Progress / Closed; reopen (DEF-005/006)
- [x] Assign (`defects.assign`); In Progress (DFW-001)
- [x] Corrective action + repair notes + evidence; template mandatory kare to lazmi (DFW-002/003)
- [x] Har defect par chhota verification check lazmi before closure (DFW-004, DEF-AC-02)
- [x] Verification approval jahan template maange (DFW-005)
- [x] Separation of duties: verifier khud approve na kare; Major/Critical par default ON (DFW-006/007, DEF-AC-03)
- [x] Approver na mile → awaiting approval, plant Restricted, Manager/Admin ko notify (DFW-008)
- [x] Override: authorised + audited, original failure mehfooz (DFW-009, DEF-AC-05)
- [x] Close sirf jab saari verification/approval poori (DFW-010/011)
- [x] Close se plant khud Online nahi (DEF-AC-04); Technician return to service nahi kar sakta (DFW-012/013)
- [x] Web: Defects page (filters: severity, status, site, plant)
- [x] Web: Defect detail (kaam, evidence, verification, approve, close, reopen, override)
- [x] Web: Plant profile ka Defects tab
- [x] Tests: defects (DEF-AC-01 se 05, separation, override, scope)

## Phase 5 — Mobile app par checks (FRD 21) — *agar M3 mein ho*

- [ ] PoC sync ki jagah asli checks: scope ke checks / tasks khud download (MOB-003)
- [ ] Offline jawab, comments, photos, meter readings (MOB-004)
- [ ] Local waqt + user attribution; connection wapas aane par auto sync (MOB-005)
- [ ] Conflict: pehli submission jeete, doosre ko saaf message (MOB-006/007, MOB-AC-04)
- [ ] Offline evidence sahi sawal se juda rahe (MOB-AC-02)
- [ ] Access revoke → agli sync par rok (MOB-AC-03)
- [ ] Defects dekhna mobile par
- [ ] Tests: mobile model + sync

## Phase 6 — Testing aur delivery

- [x] Tenant isolation tests mein saare naye tables + files
- [x] Browser test: schedule → check → fail → defect → verification → approve → return to service
- [x] Dashboard: Due / Overdue checks, Open defects cards
- [x] Demo data: templates, schedules, checks, defects
- [x] Design doc update + Milestone 3 acceptance evidence
- [x] Lint, typecheck, saare tests pass
- [ ] Staging par deploy + check (aap ke Render/Supabase par `db:migrate`)

---

## Acceptance criteria (FRD)

- [x] Draft template se production check nahi banta (TMP-AC-01)
- [x] Published version baad ke versions ke baad bhi reproducible (TMP-AC-02)
- [x] Naya version started/submitted/completed check nahi badalta (TMP-AC-03)
- [x] Defect trigger wala sawal sirf trigger jawab par defect banata hai (TMP-AC-04)
- [x] Recurring rule sahi interval aur sahi start/completion date se checks banata hai (SCH-AC-01)
- [x] Plant Offline → schedule pause, history mehfooz (SCH-AC-02)
- [x] Return to service se schedule dobara (SCH-AC-03)
- [x] Supervisor ek check reschedule kare, rule na badle (SCH-AC-04)
- [x] Mandatory sawal baqi → submit block aur nishan dehi (CHK-AC-01)
- [x] Do contributors alag sawal save karein, attribution na khoye (CHK-AC-02)
- [x] Doosri submission pehli ko overwrite nahi karti (CHK-AC-03)
- [x] Submitted edit original jawab + reason rakhta hai (CHK-AC-04)
- [x] Trigger ke baghair fail jawab defect nahi banata (DEF-AC-01)
- [x] Verification ke baghair defect close nahi (DEF-AC-02)
- [x] Separation ON ho to apni verification approve nahi (DEF-AC-03)
- [x] Defect close se plant khud return to service nahi (DEF-AC-04)
- [x] Har override original failure aur user audit mein rakhta hai (DEF-AC-05)

---

## Progress log

- Plan approve hua; checklist bani.
- **Phase 1 ✅** Template engine: 5 purposes, eligibility (plant type/category, discipline, team, user), single-selection, conditional follow-up (sirf pehle wale sawal ka), defect trigger + severity, separation rule, verification ke liye corrective action/evidence lazmi, suggested recurrence, duplicate, publish par "unstarted checks bhi naye version par". Purane published versions waisay hi parhe jate hain.
- **Phase 2 ✅** Schedules: daily/weekly/monthly/quarterly/annual/custom, start date, completion ya fixed cycle, ek waqt mein ek check, weekly hafte ke Monday se Due (org time zone), Overdue + notification ek dafa, plant Offline par pause (unstarted check cancel, history mehfooz) aur RTS date + interval se resume — DB trigger se, har raste par. Sweep har 15 minute (`SCHEDULE_SWEEP_MINUTES`).
- **Phase 3 ✅** Checks: per-question save (do log saath kaam kar sakte hain), har badlao ki history, first submission wins (row lock), submit ke baad read-only, review approve/return/reject, reopen, Manager/Admin edit with reason, cancel with reason, photo/PDF evidence (GPS nikal diya jata hai), meter readings, offline trigger, PDF export with contributors, check ki audit history.
- **Phase 4 ✅** Defects: sirf trigger wale fail jawab se (check aur reception dono), classify/assign, In Progress (sirf assigned Technician ya Supervisor+), corrective action + evidence, verification check, separation of duties + override (reason ke saath), koi approver na ho to Manager/Admin ko notification, close sirf verification ke baad, close se plant Online nahi hota, khula "Offline" Defect RTS rokta hai (override with reason), reopen sirf Manager/Admin.
- **Phase 6 ✅** Tests: 28 naye integration tests (`checks.int-spec.ts`), isolation (`checks-isolation.int-spec.ts`), recurrence + question unit tests, browser test `e2e/tests/milestone-3.spec.ts` (pass). Demo data (`seed-checks.ts`), dashboard cards, notification bell, design doc + acceptance evidence.
- Browser check mein mile aur theek kiye: photo upload par unsaved jawab mit jaate the; akela verification template dobara click par khali ho jata tha; Defects + documents dono ki rok ek saath nahi dikhti thi; checks list mein bina due date wale upar aate the.
- **Baqi:** mobile app abhi M1 PoC par hai (web: Checks › Mobile sync demo). Staging par migration.
- M2 se: staging deploy abhi baqi (Render par `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEB_APP_URL`).
- **Cross-check (FRD poora milaya):** M3 = API + customer web app. Mobile ka asli offline kaam, email (Brevo) aur push (M1 design doc ke mutabiq) M4 mein hain. Theek kiya: Checks par "Completed" view (NAV-002); checks par site/template/status filters + "Clear filters", defects par site filter (LST-002/003); dashboard "My checks" count ab list se barabar (DSH-AC-01); "Close Defect" sirf unhein dikhta hai jo close kar sakte hain (VAL-003).
- **Faisle baqi (client se):** reports (FRD 18) kis milestone mein; template ki "Applicable plant types" lazmi ho ya khali = sab (Appendix B); Supervisor Defect reopen kar sake ya nahi (DFW-011 vs Appendix C — abhi Appendix C: sirf Manager/Admin).
- **Izafa (aap ke kehne par):**
  - Check-template import (FRD 19.4): Excel/CSV template (wazahat aur allowed values ke saath), upload → har row ki jaanch (sawal ki type, mandatory, evidence, triggers, follow-up, plant types, disciplines, meter types, naam ka takrao) → app mein row theek karna → sirf Draft templates banana → error report. 3 integration tests + browser test.
  - Dashboard (FRD 6): due today/week/month, overdue, review, 7 din ke failed aur Defect wale checks, severity ke hisaab se Defects (Critical alag, icon + text), plant Online/Offline aur reception, documents ke masle, haal ke mukammal checks (plant, type, kis ne, kab, result), haal ki plant status tabdeeliyan. Har number click par wahi filtered list kholta hai aur gintiyan list se barabar hain (test se sabit).
  - Checks aur Defects list ka CSV export usi filter aur scope ke saath (LST-004).
  - Defect close hone par notification (NTF-005).

