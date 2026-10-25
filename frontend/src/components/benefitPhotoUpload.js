import { benefitImage } from './benefitsManagementModel.js'
import { requestJsonResponse } from './requestTimeout.js'

export const BENEFIT_PHOTO_TYPES = 'image/jpeg,image/png,image/webp'
export const BENEFIT_PHOTO_MAX_BYTES = 5 * 1024 * 1024

// The business API only signs the request. Binary image data uploads directly
// to Cloudinary; the owner's bearer is used only by our signing API.
export async function uploadBenefitPhoto({ file, request, businessSlug, signal, send = fetch }) {
  if (!file || !BENEFIT_PHOTO_TYPES.split(',').includes(file.type)) throw new Error('Choose a JPG, PNG or WebP photo.')
  if (!file.size || file.size > BENEFIT_PHOTO_MAX_BYTES) throw new Error('Choose a photo up to 5 MB.')
  const signature = await request(`/api/v1/business/${encodeURIComponent(businessSlug)}/cloudinary-signature?purpose=lt_benefits`, { method: 'POST', signal })
  if (!/^[A-Za-z0-9_-]+$/.test(signature?.cloud_name || '') || !signature.api_key || !signature.signature || !signature.timestamp || !signature.folder || !signature.upload_preset) throw new Error('Could not prepare the photo upload. Please try again.')
  const body = new FormData()
  body.append('file', file)
  for (const key of ['api_key', 'timestamp', 'signature', 'folder', 'upload_preset']) body.append(key, signature[key])
  const { response, payload } = await requestJsonResponse(send,
    `https://api.cloudinary.com/v1_1/${signature.cloud_name}/image/upload`,
    { method: 'POST', body, signal }, { timeoutMs: 45000, message: 'The photo upload timed out. Try again with a smaller photo.' })
  if (!response.ok) throw new Error('Could not upload the photo. Please try again.')
  const image = benefitImage(payload?.secure_url)
  if (!image) throw new Error('The uploaded photo did not return a valid HTTPS image URL.')
  const url = new URL(image)
  if (url.hostname !== 'res.cloudinary.com' || !url.pathname.startsWith(`/${signature.cloud_name}/image/upload/`)) throw new Error('The uploaded photo did not return a public Cloudinary image URL.')
  return image
}
