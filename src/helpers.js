import crypto from 'crypto'

/** @typedef {import('vinyl')} File */
/* eslint-disable no-magic-numbers */

function hash(key) {
  return crypto.createHash('md5').update(key).digest('hex')
}

/**
 * @param {File} file the file
 * @returns {number} size of the file in bytes
 */
function fileBytes(file) {
  if (!file.isBuffer()) return 0
  return file.contents.byteLength
}

function humanizeBytes(bytes = 0) {
  if (typeof bytes !== 'number') return 'n/a'
  if (bytes === 0) return '0 Bytes'

  const exp = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10)
  if (exp === 0) return `${bytes} Bytes`

  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  return `${(bytes / Math.pow(1024, exp)).toFixed(1)} ${sizes[exp]}`
}

export { hash, fileBytes, humanizeBytes }
