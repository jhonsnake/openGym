const IMAGE_ID = /^sha256:[0-9a-f]{64}$/

export function validateHarnessInputs({ image, imageTag, imageId, artifactRoot }) {
  if (typeof image !== 'string' || image.length === 0) throw new Error('OPENGYM_E2E_API_IMAGE is required')
  if (typeof imageTag !== 'string' || imageTag.length === 0) throw new Error('OPENGYM_E2E_API_IMAGE_TAG is required')
  if (typeof imageId !== 'string' || imageId.length === 0) throw new Error('OPENGYM_E2E_API_IMAGE_ID is required')
  if (image !== imageTag) throw new Error('OPENGYM_E2E_API_IMAGE must equal OPENGYM_E2E_API_IMAGE_TAG')
  if (!IMAGE_ID.test(imageId)) throw new Error('OPENGYM_E2E_API_IMAGE_ID must be sha256:64 lowercase hexadecimal characters')
  if (typeof artifactRoot !== 'string' || artifactRoot.length === 0) throw new Error('OPENGYM_E2E_ARTIFACT_ROOT is required')
  if (!artifactRoot.startsWith('/') || artifactRoot === '/' || artifactRoot === '/tmp') throw new Error('OPENGYM_E2E_ARTIFACT_ROOT must be an explicit private artifact root')
  return { image, imageTag, imageId, artifactRoot }
}

export const imageIdPattern = IMAGE_ID
