// src/lib/anchors.js
//
// API client for the video Anchor library — reusable {image + description}
// cards that map onto MiniMax Hailuo's subject_reference[] / first_frame_image
// params for cross-generation subject/scene consistency.
//
// All endpoints are documented in docs/superpowers/specs/2026-07-20-video-anchor-design.md.
// Storage is server-side at workspace/anchors/ (JSON manifest + image files).

import { apiFetch } from './api.js'

/**
 * List the anchor library, most-recently-updated first.
 * @returns {Promise<Array<{id,name,type,description,image,created_at,updated_at}>>}
 */
export async function listAnchors() {
  const res = await apiFetch('/api/anchors')
  if (!res.ok) throw new Error(`listAnchors failed: ${res.status}`)
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'listAnchors failed')
  return data.anchors || []
}

/**
 * Create a new anchor. The image is sent inline as a base64 data URL
 * (matches how first_frame_image / subject_reference are sent to /api/video).
 *
 * @param {Object} params
 * @param {string} params.name           1–60 chars
 * @param {string} [params.description]  0–500 chars
 * @param {string} params.image_data_url data:image/<ext>;base64,...
 * @param {string} [params.source='upload']    'upload' | 'image-history'
 * @param {string} [params.source_ref]    original generation id when promoted
 * @returns {Promise<Object>} the created anchor
 */
export async function createAnchor({ name, description = '', image_data_url, source = 'upload', source_ref = '' }) {
  const res = await apiFetch('/api/anchors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, image_data_url, source, source_ref }),
  })
  const data = await res.json()
  if (!res.ok || !data.success) {
    throw new Error(data.detail || data.error || `createAnchor failed: ${res.status}`)
  }
  return data.anchor
}

/**
 * Update name / description of an anchor. Only non-null fields are sent.
 * @returns {Promise<Object>} the updated anchor
 */
export async function updateAnchor(id, { name, description }) {
  const body = {}
  if (name !== undefined) body.name = name
  if (description !== undefined) body.description = description
  const res = await apiFetch(`/api/anchors/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || !data.success) {
    throw new Error(data.detail || data.error || `updateAnchor failed: ${res.status}`)
  }
  return data.anchor
}

/**
 * Delete an anchor. Also removes its image file server-side.
 */
export async function deleteAnchor(id) {
  const res = await apiFetch(`/api/anchors/${id}`, { method: 'DELETE' })
  const data = await res.json()
  if (!res.ok || !data.success) {
    throw new Error(data.detail || data.error || `deleteAnchor failed: ${res.status}`)
  }
  return data.deleted
}

/**
 * Auto-describe an image via MiniMax VLM (understand_image). Works both
 * pre-commit (image_data_url from a just-dropped File) and post-commit
 * (anchor_id from a saved library entry). Exactly one must be provided.
 *
 * @param {Object} params
 * @param {string} [params.anchor_id]
 * @param {string} [params.image_data_url]
 * @returns {Promise<string>} the description text (≤500 chars)
 */
export async function describeAnchor({ anchor_id, image_data_url }) {
  const body = {}
  if (anchor_id) body.anchor_id = anchor_id
  if (image_data_url) body.image_data_url = image_data_url
  const res = await apiFetch('/api/anchors/describe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || !data.success) {
    throw new Error(data.detail || data.error || `describeAnchor failed: ${res.status}`)
  }
  return data.description
}

/**
 * Read a File object as a base64 data URL — used to send anchor images
 * to the backend inline (no separate upload step). Mirrors VideoPanel
 * and ImagePanel's readFileAsDataURL helpers.
 */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}


/**
 * Resolve an anchor's image path to a displayable URL. Anchors store
 * workspace-relative paths (e.g. "anchors/abc.png"); assetUrl prefixes
 * the backend origin and routes through /api/files/raw.
 */
export function anchorImageUrl(anchor, assetUrlFn) {
  const rel = anchor?.image?.path
  if (!rel) return null
  return assetUrlFn(`/api/files/raw?path=${encodeURIComponent(rel)}`)
}

/**
 * Fetch an image URL (e.g. /api/files/raw?path=...) and return it as a
 * base64 data URL. Required because the MiniMax video API needs data
 * URLs for first_frame_image / subject_reference — a workspace-relative
 * path string is useless to the remote generator.
 *
 * Returns '' on any failure (caller skips the field).
 */
export async function fetchImageUrlAsDataUrl(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return ''
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}

/**
 * Resolve an anchor's saved image to a base64 data URL by fetching it
 * through the /api/files/raw endpoint. Used by VideoPanel.generate()
 * before POSTing to /api/video.
 */
export async function anchorToDataUrl(anchor, assetUrlFn) {
  const rel = anchor?.image?.path
  if (!rel) return ''
  const url = assetUrlFn(`/api/files/raw?path=${encodeURIComponent(rel)}`)
  return fetchImageUrlAsDataUrl(url)
}
