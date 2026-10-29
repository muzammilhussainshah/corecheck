# Milestone 2 — Plant Reception and Compliance: live checklist

Har kaam mukammal hone par yahan `[x]` lagta hai. `🔄` = abhi chal raha hai.
Branch: `milestone2`. Scope: ITDR Milestone 2 + FRD sections 7, 8, 9, 14, 19.2.

**Abhi:** Phase 4 — Reception (template + reception check + approval) 🔄

---

## Phase 1 — Admin configuration (Manage section)

- [x] Database: plant types, categories, owners/hire companies, custom fields, meter types, document types, mandatory documents (RLS ke saath)
- [x] API: har list ka add / edit / archive / restore + audit
- [x] Permissions: `plant_config.manage`, `meters.configure`, `documents.configure` server par enforce
- [x] Web: Manage mein Plant types screen
- [x] Web: Plant categories screen
- [x] Web: Owners / hire companies screen
- [x] Web: Custom fields screen (text, number, date, dropdown; required/optional)
- [x] Web: Meter types screen (naam + unit)
- [x] Web: Document types screen (expiry hai ya nahi, warning kitne din pehle)
- [x] Web: Mandatory documents by plant type
- [x] Tests: configuration API (permissions, duplicates, archive, tenant isolation)

## Phase 2 — Plant register aur plant record

- [x] Database: plants table (RLS), System Asset ID unique per organisation, Plant No./Serial non-unique
- [x] System Asset ID auto-generate (`PLT-000001`) ya manual; duplicate block (PLT-002/003)
- [x] Plant No. / Serial duplicate par warning + matching plants (PLT-004)
- [x] Required fields validation (PLT-006)
- [x] Custom field values save/validate
- [x] Lifecycle: Pending Reception → Awaiting Approval → Approved/Online / Restricted/Offline → Archived (PLC-001)
- [x] Restriction reasons: Quarantined, Not in Use, Off-hired (PLC-002)
- [x] Operative apna Pending plant edit kar sake; submit ke baad lock (PLC-003/004)
- [x] Manual status change / override: reason zaroori, original audit mein (PLC-007)
- [x] Archive / restore (PLC-006)
- [x] Site scope: user sirf apni sites ke plant dekhe/badle
- [x] Web: Plant Register list (columns, search, filters, pagination)
- [x] Web: Add plant form
- [x] Web: Plant profile (Overview, Reception, Documents, Meter readings, Audit; Checks/Defects khali tabs)
- [x] Register export Excel / CSV (PLR-004)
- [x] QR code: random token, login + scope zaroori (PLT-AC-04)
- [x] QR labels PDF print (ek ya kai plants)
- [x] Tests: plant API + lifecycle + scope + duplicate Asset ID

## Phase 3 — Documents aur compliance

- [x] File storage: Supabase Storage private bucket (local dev ke liye disk)
- [x] Upload: type, reference, issue/expiry date, file (PDF/JPG/PNG, 20 MB, asal type check)
- [x] Download sirf API se, scope check ke baad
- [x] Verify / Reject (verifier + waqt record)
- [x] Status: Missing, Awaiting Verification, Valid, Approaching Expiry, Expired, Rejected, Archived
- [x] Replace: purana version + verification history mehfooz
- [x] Compliance engine: missing/expired mandatory document → approval block + Restricted/Offline
- [x] Har raat expiry check (plants restrict + audit)
- [x] Document restriction override: reason + review date, original mehfooz
- [x] Web: Plant profile ka Documents tab (upload, verify, replace, history)
- [x] Tests: documents + compliance + file tenant isolation

## Phase 4 — Reception

- [ ] Reception template: Draft → Published (immutable version), naya version on edit
- [ ] Sawal ki types: yes/no, pass/fail, text, number, photo/file, meter reading
- [ ] Sawal settings: mandatory, comment zaroori, photo zaroori, fail par Offline
- [ ] Template setting: automatic ya manual approval
- [ ] Web: Template builder (Manage)
- [ ] Assign: Supervisor/Manager/Admin plant par template assign kare
- [ ] Reception bharna: draft save, photos, meter reading, submit
- [ ] Auto approval → Approved/Online (sab rules pass)
- [ ] Manual approval → Awaiting Approval → approve / return with comment
- [ ] Offline trigger fail ya document missing → Restricted/Offline
- [ ] Template version + har jawab + kis ne diya + evidence mehfooz
- [ ] Web: Reception screen (plant profile se)
- [ ] Tests: reception journey (auto, manual, return, offline trigger, missing document)

## Phase 5 — Meter readings

- [ ] Plant par kai meter types
- [ ] Reading: reception se ya manual (value, unit, waqt, source, user)
- [ ] Correction: reason zaroori, asli value mehfooz
- [ ] Web: Plant profile ka Meter readings tab (history)
- [ ] Tests: readings + corrections

## Phase 6 — Plant import

- [ ] Template download (Excel/CSV) valid values ke saath
- [ ] Upload → row-level preview (missing, invalid, duplicate Asset ID block, Plant No./Serial warning)
- [ ] Sahi rows import; galat rows app mein theek karke dobara validate
- [ ] Error report download
- [ ] Import record: kis ne, kab, file, row outcomes, bane plant IDs
- [ ] Sirf naye plant (update/merge nahi)
- [ ] Web: Import wizard
- [ ] Tests: import

## Phase 7 — Testing aur delivery

- [ ] Tenant isolation tests mein saare naye tables + files
- [ ] Browser test: plant banao → document → reception → approve
- [ ] Demo data: plants, documents, reception template
- [ ] Design doc update + Milestone 2 acceptance evidence
- [ ] Lint, typecheck, saare tests pass
- [ ] Staging par deploy + check

---

## Acceptance criteria (ITDR)

- [ ] Operative Pending Reception plant bana kar submit kar sake
- [ ] Plant lifecycle FRD ke mutabiq
- [ ] Duplicate System Asset ID block
- [ ] Plant Number / Serial Number par sirf warning
- [ ] Missing/expired mandatory document approval rokta hai
- [ ] Kamyab reception → Online; configured failure → Offline
- [ ] Plant workflow actions audit mein
- [ ] Import: preview, validation, corrections, error report

---

## Progress log

- Plan approve hua; checklist bani. Phase 1 shuru.
- Phase 1 backend mukammal: 7 nayi tables (RLS ke saath), `/config/...` API, duplicate naam ke saaf messages, audit, 9 integration tests pass.
- Phase 1 web mukammal: Manage mein "Plant" group ke 6 screens (types, categories, companies, custom fields, meter types, document types) + mandatory documents. Browser mein check kiya.
- Sath mein fix: duplicate naam ka error ab form ke field ke neeche dikhta hai (pehle sirf 3 second ka toast tha) — Sites, Teams, Roles waghera par bhi.
- **Phase 1 mukammal ✅**
- Phase 2 backend mukammal: plants table (RLS), Asset ID generate/duplicate block, Plant No./Serial warnings, custom values, restrict/return to service, archive, history, Excel/CSV export (formula-injection se mehfooz), QR token + labels PDF. 14 plant tests + naya test jo har org table par RLS check karta hai.
- Phase 2 web mukammal: Plant register (status cards, search, filters, pagination), Add/Edit form (duplicate warning live), profile (tabs + history), Restrict / Return to service / Archive, Excel/CSV export, QR labels PDF, `/q/<token>` scan page. Quick actions mein "Add Plant". Browser mein poora flow check kiya.
- Sath mein fix: (1) login ke baad wapas usi page par (QR scan ke liye, sirf app ke andar ke paths). (2) Chrome binary downloads ko khali 204 bana deta tha — ab file naam `X-Filename` header mein. (3) QR label par lamba naam/organisation ab label ke andar hi rehta hai.
- **Phase 2 mukammal ✅**
- Phase 3 backend mukammal: documents + versions (purani file/verification mehfooz), PDF/JPEG/PNG ki asal type check, photo metadata (GPS) hataya jata hai, verify/reject, status database views se (org time zone), compliance engine (approved plant ka mandatory document missing/expired/rejected → khud Restricted), har ghante expiry check, override sirf reason + review date ke sath (Manager/Admin). Production mein Supabase Storage lazmi. 11 naye tests; kul 142 pass.
- Phase 3 web mukammal: plant ka Documents tab (mandatory documents ki halat, upload, view, download, verify, reject, naya version, archive, purane versions), "Documents" main page (Expired / Approaching / Awaiting / Rejected cards + filters), register mein Documents column + filter, Return to service par documents ki rok aur override form (reason + review date). Browser mein poora flow check kiya: reject karte hi approved plant khud Restricted hua.
- Deploy ke liye note: production/staging mein `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` set karne honge (docs/environments.md).
- **Phase 3 mukammal ✅**
