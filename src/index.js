import PluginError from 'plugin-error'
import through from 'through2'
import TaskProxy from './task-proxy'

function defaultKey(file) {
  return file.contents.toString('base64')
}

plugin.defaultOptions = {
  key: defaultKey,
  verbose: false,
  memo: new Map(),
  clearMemoOnFlush: true,
}

function plugin(task, inputOptions = {}) {
  // Check for required task option
  if (!task) {
    throw new PluginError('gulp-memoize', 'Must pass a task to cache()')
  }

  const options = {
    ...plugin.defaultOptions,
    ...(task.cacheable || {}),
    ...inputOptions,
  }
  const taskProxy = new TaskProxy(task, options)

  function each(file, enc, next) {
    if (file.isNull()) {
      next(null, file)
      return
    }

    if (file.isStream()) {
      next(new PluginError('gulp-memoize', 'Cannot operate on stream sources'))
      return
    }

    const signals = taskProxy.processFile(file)

    signals.on('error', (err) => {
      next(new PluginError('gulp-memoize', err))
    })

    signals.on('file', (file) => {
      this.push(file)
    })

    signals.on('done', () => {
      next(null)
    })
  }

  function flush(next) {
    taskProxy.flush(next)
  }

  return through.obj(each, flush)
}

plugin.clearDefaultMemo = () => {
  plugin.defaultOptions.memo.clear()
}

module.exports = plugin
