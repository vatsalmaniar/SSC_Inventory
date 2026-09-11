// THE document vocabulary and uploader for People 360 and Talent 360.
//
// WHY THIS EXISTS. Candidate documents and employee documents were written by
// two different pieces of code with two different vocabularies: Talent stored
// doc_type 'offer_letter', People 360 looked for 'Offer Letter'. Nothing
// errored — a candidate's paperwork was copied onto their employee record when
// they joined and then simply never appeared, because the tab was searching for
// a string nobody wrote. A shared list is the only fix that stays fixed.
//
// The upload dance is also identical in all three places (validate → put object
// → write row → remove the object if the row fails), and a third hand-rolled
// copy is how one of them ends up leaving orphans in the bucket.
//
// Buckets are private (sql/talent_360_up.sql). Never getPublicUrl — CVs, PAN
// cards and Aadhaar cards are personal data; links are signed on demand.

import { sb } from './supabase'

export const TALENT_BUCKET = 'talent-docs'
export const EMPLOYEE_BUCKET = 'employee-docs'

// Mirrors file_size_limit and allowed_mime_types on both buckets. Checked in
// the browser so an oversized scan fails instantly instead of after a minute
// of uploading, then enforced again by storage — the client is the courtesy,
// the bucket is the rule.
export const MAX_DOC_MB = 10
export const MAX_DOC_BYTES = MAX_DOC_MB * 1024 * 1024
export const ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]
// Extensions rather than image/*, which would let the picker offer a GIF that
// the bucket then rejects with an unhelpful error.
export const ACCEPT_ATTR = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.heic,.heif'

// ── The vocabulary ─────────────────────────────────────────────────────────
// `key` is what goes in doc_type. It is snake_case and it is the ONLY thing
// written to either table — labels are for humans and can change freely.
// `candidate` / `employee` say where the type is offered for upload; a type
// not offered still renders correctly if a row already has it.
export const DOC_TYPES = [
  { key: 'cv',                label: 'CV / Resume',          candidate: true,  employee: true },
  { key: 'pan_card',          label: 'PAN Card',             candidate: false, employee: true },
  { key: 'aadhaar_card',      label: 'Aadhaar Card',         candidate: false, employee: true },
  { key: 'id_proof',          label: 'Photo ID proof',       candidate: true,  employee: true },
  { key: 'address_proof',     label: 'Address proof',        candidate: true,  employee: true },
  { key: 'education',         label: 'Education certificate',candidate: true,  employee: true },
  { key: 'experience_letter', label: 'Experience letter',    candidate: true,  employee: true },
  { key: 'relieving_letter',  label: 'Relieving letter',     candidate: true,  employee: true },
  { key: 'salary_slip',       label: 'Salary slip',          candidate: true,  employee: false },
  { key: 'photograph',        label: 'Photograph',           candidate: true,  employee: true },
  { key: 'offer_letter',      label: 'Offer letter',         candidate: true,  employee: true },
  { key: 'appointment_letter',label: 'Appointment letter',   candidate: false, employee: true },
  { key: 'other',             label: 'Other',                candidate: true,  employee: true },
]

export const CANDIDATE_DOC_TYPES = DOC_TYPES.filter(d => d.candidate)
export const EMPLOYEE_DOC_TYPES  = DOC_TYPES.filter(d => d.employee)

const LABELS = Object.fromEntries(DOC_TYPES.map(d => [d.key, d.label]))
// Falls back to the raw key so a legacy or unknown value still reads as
// something, rather than rendering blank.
export const docLabel = k => LABELS[k] || k || '—'

// The four every employee file is expected to contain. Shown as chips whether
// or not they exist, so a missing one is visible rather than merely absent.
export const EXPECTED_EMPLOYEE_DOCS = ['pan_card', 'aadhaar_card', 'offer_letter', 'appointment_letter']

// Which candidate document types are worth carrying onto the employee record
// when someone joins. Salary slips from a previous employer are not — they are
// a hiring artefact, and keeping them on the staff file past the decision they
// informed serves no purpose.
export const CARRY_ON_JOIN = DOC_TYPES.filter(d => d.candidate && d.employee).map(d => d.key)

// ── Helpers ────────────────────────────────────────────────────────────────
// Storage keys must not carry spaces or non-ASCII — a signed URL for
// "Aayush's CV (final).pdf" round-trips badly.
export const safeName = s => String(s || 'file').replace(/[^\w.\-]+/g, '_').slice(-80)

/** Returns an error message, or null when the file is acceptable. */
export function validateFile(file) {
  if (!file) return 'Pick a file first.'
  if (file.size > MAX_DOC_BYTES) {
    return `That file is ${(file.size / 1048576).toFixed(1)} MB — the limit is ${MAX_DOC_MB} MB.`
  }
  // Some browsers report an empty type for .heic and the odd .doc; the bucket
  // is the backstop, so an unknown type is allowed through rather than blocked
  // on a guess.
  if (file.type && !ALLOWED_MIME.includes(file.type)) {
    return 'That file type is not accepted. Use PDF, Word, JPG, PNG, WebP or HEIC.'
  }
  return null
}

export const docPath = (bucket, ownerId, docType, fileName) =>
  `${ownerId}/${docType}/${Date.now()}-${safeName(fileName)}`

/**
 * Puts the object in the bucket, then runs `register(path)` to write the row.
 * If registering fails the object is removed, so the bucket never accumulates
 * files no row points at and nobody can see.
 *
 * @returns the storage path
 * @throws  the underlying error, for the caller to surface
 */
export async function uploadDoc({ bucket, ownerId, docType, file, register }) {
  const bad = validateFile(file)
  if (bad) throw new Error(bad)

  const path = docPath(bucket, ownerId, docType, file.name)
  const { error: upErr } = await sb.storage.from(bucket)
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (upErr) throw upErr

  try {
    await register(path)
  } catch (e) {
    await sb.storage.from(bucket).remove([path]).catch(() => {})
    throw e
  }
  return path
}

/** Fresh signed URL — these buckets are private and links must expire. */
export async function openDoc(bucket, path) {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) throw (error || new Error('Could not open that document.'))
  return data.signedUrl
}

/** Copies one object between buckets. Used when a candidate becomes an employee. */
export async function copyObject({ from, to, fromPath, toPath }) {
  const { data: blob, error } = await sb.storage.from(from).download(fromPath)
  if (error || !blob) throw (error || new Error('Could not read the source file.'))
  const { error: upErr } = await sb.storage.from(to).upload(toPath, blob, { upsert: true })
  if (upErr) throw upErr
}
