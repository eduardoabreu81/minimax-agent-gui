// src/lib/styleSheets.js
//
// Typed-by-convention API client for style sheet CRUD + draft generation.
// Every helper normalizes FastAPI `detail`, app `error`, non-JSON
// responses, and non-2xx status codes into a user-displayable Error.

import { apiFetch } from './api.js'

async function readJson(res) {
  let data = null
  try { data = await res.json() } catch { /* non-JSON body */ }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || `Request failed (${res.status})`
    throw new Error(msg)
  }
  if (data && data.success === false) {
    throw new Error(data.error || data.detail || 'Request failed')
  }
  return data
}

export async function listStyleSheets() {
  const res = await apiFetch('/api/style-sheets')
  const data = await readJson(res)
  return data.style_sheets || []
}

export async function getStyleSheet(name) {
  const res = await apiFetch(`/api/style-sheets/${encodeURIComponent(name)}`)
  const data = await readJson(res)
  return data.style_sheet
}

export async function createStyleSheet({ name, description, body }) {
  const res = await apiFetch('/api/style-sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, body }),
  })
  const data = await readJson(res)
  return data.style_sheet
}

export async function updateStyleSheet(name, { description, body }) {
  const payload = {}
  if (description !== undefined) payload.description = description
  if (body !== undefined) payload.body = body
  const res = await apiFetch(`/api/style-sheets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson(res)
  return data.style_sheet
}

export async function deleteStyleSheet(name) {
  const res = await apiFetch(`/api/style-sheets/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  const data = await readJson(res)
  return { deleted: data.deleted }
}

export async function draftStyleSheetFromBrief(brief) {
  const res = await apiFetch('/api/style-sheets/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'description', brief }),
  })
  const data = await readJson(res)
  return data.draft
}

export async function draftStyleSheetFromImage({ imagePath, imageDataUrl }) {
  if (bool(imagePath) === bool(imageDataUrl)) {
    if (imagePath && imageDataUrl) {
      throw new Error('Provide exactly one of imagePath or imageDataUrl.')
    }
    throw new Error('draftStyleSheetFromImage requires imagePath or imageDataUrl.')
  }
  const payload = { mode: 'image' }
  if (imagePath) payload.image_path = imagePath
  if (imageDataUrl) payload.image_data_url = imageDataUrl
  const res = await apiFetch('/api/style-sheets/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await readJson(res)
  return data.draft
}

function bool(x) { return !!x }
