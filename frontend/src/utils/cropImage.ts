export const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.setAttribute('crossOrigin', 'anonymous')
    image.src = url
  })

/** The longest side of an uploaded avatar, in pixels. */
export const AVATAR_MAX_SIDE = 512

export default async function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  rotation = 0
): Promise<File | null> {
  const image = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return null
  }

  // set canvas size to match the bounding box
  canvas.width = image.width
  canvas.height = image.height

  ctx.translate(image.width / 2, image.height / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.translate(-image.width / 2, -image.height / 2)

  ctx.drawImage(image, 0, 0)

  const croppedCanvas = document.createElement('canvas')
  const croppedCtx = croppedCanvas.getContext('2d')

  if (!croppedCtx) {
    return null
  }

  // An avatar is shown at most a few dozen pixels wide: the crop is scaled down to AVATAR_MAX_SIDE, so a phone photo
  // fits the bucket's 2 MB limit (security audit 07.11, SEC-4) and loads fast.
  const scale = Math.min(1, AVATAR_MAX_SIDE / Math.max(pixelCrop.width, pixelCrop.height))
  croppedCanvas.width = Math.max(1, Math.round(pixelCrop.width * scale))
  croppedCanvas.height = Math.max(1, Math.round(pixelCrop.height * scale))

  croppedCtx.drawImage(
    canvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    croppedCanvas.width,
    croppedCanvas.height
  )

  return new Promise((resolve) => {
    croppedCanvas.toBlob((blob) => {
      if (!blob) {
        resolve(null)
        return
      }
      const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
      resolve(file)
    }, 'image/jpeg', 0.9)
  })
}
