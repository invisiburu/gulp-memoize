import EventEmitter from 'events'
import log from 'fancy-log'
import clr from 'ansi-colors'
import { humanizeBytes, fileBytes, hash } from './helpers'

/** @typedef {import('vinyl')} File */
/**
 * @callback KeyGetter
 * @argument {File} file
 * @returns {string}
 */
/**
 * @typedef {object} GulpMemoizeOptions
 * @property {boolean} [verbose] - report on every memo restore
 * @property {KeyGetter} [key] - redefine key calculation
 * @property {Map<string, File[]>} [memo] - memo instance
 * @property {boolean} [clearMemoOnFlush] - clear memo on cache
 */

export default class TaskProxy {
  constructor(task, inputOptions) {
    this.task = task
    /** @type {GulpMemoizeOptions} */
    this.options = inputOptions

    /** @type {Map<string, File[]>} */
    this._memo = this.options.memo || new Map()
    this._memoBytes = 0
    for (const cell of this._memo.values()) {
      this._memoBytes += cell.reduce((acc, file) => acc + fileBytes(file), 0)
    }

    /** @type {Array<Function>} */
    this._listenerRemovers = []
    this._restoredCount = 0

    if (task) {
      this._patchTask()
    }
  }

  /**
   * @param {File} inputFile the input file
   * @param {EventEmitter} signals the signals event emitter
   * @returns {EventEmitter} the signals
   */
  processFile(inputFile, signals = new EventEmitter()) {
    process.nextTick(async () => {
      const memoKey = await this._getFileKey(inputFile)
      const memoFile = this._restore(memoKey, inputFile)

      if (memoFile) {
        signals.emit('file', memoFile)
        signals.emit('done')
        this._listenerRemovers.push(() => signals.removeAllListeners())
      } else {
        this._runTaskAndRemember(inputFile, memoKey, signals)
      }
    })
    return signals
  }

  async flush(next) {
    try {
      if (typeof this.task._flush === 'function') {
        this.task._flush(async (...args) => {
          await this._flush()
          next(...args)
        })
      } else {
        await this._flush()
        next()
        return
      }
    } catch (err) {
      next(err)
      return
    }
  }

  async _getFileKey(file) {
    const key = await this.options.key(file)
    return key ? hash(key) : key
  }

  _runTaskAndRemember(file, memoKey, signals = new EventEmitter()) {
    signals.on('cache', (memoFile) => {
      this._remember(memoKey, memoFile)
      signals.emit('file', memoFile)
    })

    return this._runTask(file, memoKey, signals)
  }

  _runTask(file, memoKey, signals = new EventEmitter()) {
    const onError = (err) => signals.emit('error', err)
    const onTransformed = () => signals.emit('done')
    const onData = (datum) => {
      if (datum._memoKey !== memoKey) return
      Reflect.deleteProperty(datum, '_memoKey')

      const signal = signals.listenerCount('cache') >= 1 ? 'cache' : 'file'
      signals.emit(signal, datum)
    }
    const listenersCount = 3

    this._listenerRemovers.push(() => {
      this.task.removeListener('error', onError)
      this.task.removeListener('gulp-memoize:transformed', onTransformed)
      this.task.removeListener('data', onData)
      this.task.setMaxListeners(this.task._maxListeners - listenersCount)
      signals.removeAllListeners()
    })

    // Bump up max listeners to prevent memory leak warnings
    this.task.setMaxListeners((this.task._maxListeners || 0) + listenersCount)

    this.task.on('data', onData)
    this.task.once('gulp-memoize:transformed', onTransformed)
    this.task.once('error', onError)

    file._memoKey = memoKey

    // Run through the other task and grab output (or error)
    this.task.write(file)

    return signals
  }

  /**
   * @param {string} memoKey the memo key
   * @param {File} memoFile the memo file
   * @returns {void}
   */
  _remember(memoKey, memoFile) {
    const fileCopy = memoFile.clone({ contents: false })
    if (this._memo.has(memoKey)) {
      this._memo.get(memoKey).push(fileCopy)
    } else {
      this._memo.set(memoKey, [fileCopy])
    }

    this._memoBytes += fileBytes(fileCopy)
    if (this.options.verbose) this._reportRemembered(memoFile)
  }

  /**
   * @param {string} memoKey the memo key
   * @param {File} inputFile the input file
   * @returns {void}
   */
  _restore(memoKey, inputFile) {
    const cell = this._memo.get(memoKey)
    if (!cell) {
      return null
    }

    const memoFile =
      cell.length === 1
        ? cell[0]
        : cell.find((el) => el.basename === inputFile.basename) || cell[0]
    const restoredFile = memoFile.clone({ contents: false })
    restoredFile.path = inputFile.path
    restoredFile.base = inputFile.base

    if (this.options.verbose) this._reportRestored(memoFile, inputFile)
    this._restoredCount++

    return restoredFile
  }

  /**
   * @param {File} memoFile the memo file
   * @returns {void}
   */
  _reportRemembered(memoFile) {
    const suf = clr.gray(`(Memo is ${humanizeBytes(this._memoBytes)})`)
    log(`gulp-memoize: ${clr.green('✔')} ${memoFile.relative} ${suf}`)
  }

  /**
   * @param {File} memoFile the memo file
   * @param {File} inputFile the original file
   * @returns {void}
   */
  _reportRestored(memoFile, inputFile) {
    const src = clr.gray(`(${memoFile.relative})`)
    log(`gulp-memoize: ${clr.gray('✔')} ${inputFile.relative} ${src}`)
  }

  _reportTotal() {
    const size = humanizeBytes(this._memoBytes)
    log(`gulp-memoize: Restored ${this._restoredCount} items, memo is ${size}`)
  }

  _patchTask() {
    const _transform = this.task._transform
    this.task._transform = (chunk, encoding, next) => {
      Reflect.apply(_transform, this.task, [
        chunk,
        encoding,
        (...args) => {
          next(...args) // eslint-disable-line
          this.task.emit('gulp-memoize:transformed')
        },
      ])
    }
  }

  async _flush() {
    this._reportTotal()
    this._listenerRemovers.forEach((remove) => remove())
    this._listenerRemovers = []
    if (this.options.clearMemoOnFlush) this._memo.clear()
  }
}
