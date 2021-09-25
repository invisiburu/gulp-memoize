// import crypto from 'crypto'
import path from 'path'
import File from 'vinyl'
import through from 'through2'
import sinon from 'sinon'
import memoize from '../src'

memoize.defaultOptions.clearMemoOnFlush = false

describe('gulp-memoize', () => {
  let sandbox = null
  let fakeFileHandler = null
  let fakeTask = null

  beforeEach((done) => {
    sandbox = sinon.createSandbox()

    // Spy on the fakeFileHandler to check if it gets called later
    fakeFileHandler = sandbox.spy((file, enc, cb) => {
      file.ran = true

      if (Buffer.isBuffer(file.contents)) {
        file.contents = Buffer.from(`${String(file.contents)}-modified`)
      }

      cb(null, file)
    })

    fakeTask = through.obj(fakeFileHandler)
    done()
  })

  afterEach(() => {
    sandbox.restore()
    memoize.clearDefaultMemo()
  })

  it('throws an error if no task is passed', () => {
    expect(() => memoize()).toThrow()
  })

  it('pass through the directories', (done) => {
    const directory = new File()
    const proxied = memoize(fakeTask)

    proxied
      .on('data', (file) => {
        expect(file).toEqual(directory)
        expect(file.isNull()).toBe(true)
        done()
      })
      .end(new File())
  })

  describe('in streaming mode', () => {
    it('does not work', (done) => {
      // Create a proxied plugin stream
      const proxied = memoize(fakeTask, {
        key(file, cb) {
          // For testing async key generation
          setTimeout(() => {
            cb(null, '123')
          }, 1)
        },
      })

      proxied
        .on('error', (err) => {
          expect(err.message).toBe('Cannot operate on stream sources')
          done()
        })
        .end(new File({ contents: through() }))
    })
  })

  describe('in buffered mode', () => {
    it('only caches successful tasks', (done) => {
      // Create a proxied plugin stream
      const valStub = sandbox.stub().returns({
        ran: true,
        cached: true,
      })

      memoize(fakeTask, {
        success() {
          return false
        },
        value: valStub,
      })
        .on('data', () => {
          expect(valStub.called).toBe(false)
          done()
        })
        .end(
          new File({
            contents: Buffer.from('abufferwiththiscontent'),
          })
        )
    })

    it('sets the content correctly on subsequently ran cached tasks', (done) => {
      // Create a proxied plugin stream
      const proxied = memoize(fakeTask)

      proxied.once('data', (file) => {
        expect(String(file.contents)).toBe('abufferwiththiscontent-modified')

        proxied.once('data', (file2) => {
          expect(file2.isBuffer()).toBe(true)
          expect(String(file2.contents)).toBe('abufferwiththiscontent-modified')
        })

        proxied.end(
          new File({
            path: '/some/path',
            contents: Buffer.from('abufferwiththiscontent'),
          })
        )
      })

      proxied.write(
        new File({
          path: '/some/path',
          contents: Buffer.from('abufferwiththiscontent'),
        })
      )

      proxied.on('end', done)
    })

    it('can proxy a task with specific options', (done) => {
      // create the fake file
      const fakeFile = new File({
        path: '/some/path',
        contents: Buffer.from('abufferwiththiscontent'),
      })
      const otherFile = new File({
        path: '/some/path',
        contents: Buffer.from('abufferwiththiscontent'),
      })
      const opts = {
        value(file) {
          return {
            ran: file.ran,
            cached: true,
            contents: file.contents || file._contents,
          }
        },
      }
      // Create a proxied plugin stream
      let proxied = memoize(fakeTask, opts)

      // write the fake file to it
      proxied.write(fakeFile)

      // wait for the file to come back out
      proxied.once('data', (file) =>
        proxied._flush(() => {
          // make sure it came out the same way it went in
          expect(file.isBuffer()).toBe(true)

          // check the contents are same
          expect(String(file.contents)).toEqual(
            'abufferwiththiscontent-modified'
          )
          // Check it assigned the proxied task result
          expect(file.ran).toEqual(true)
          // expect(file.cached).toBeFalsy()

          // Check the original task was called
          expect(fakeFileHandler.called).toEqual(true)

          // Reset for the second run through
          fakeFileHandler.resetHistory()
          // Refresh proxied
          proxied = memoize(fakeTask, opts)
          // Write the same file again, should be cached result
          proxied.write(otherFile)

          proxied.once('data', (secondFile) => {
            expect(secondFile.isBuffer()).toEqual(true)

            expect(String(secondFile.contents)).toEqual(
              'abufferwiththiscontent-modified'
            )

            // Cached value should have been applied
            expect(secondFile.ran).toEqual(true)
            // expect(secondFile.cached).toEqual(true)

            // Should not have called the original task
            expect(fakeFileHandler.called).toEqual(false)

            done()
          })
        })
      )
    })

    it('can proxy a task using task.cacheable', (done) => {
      // Let the task define the cacheable aspects.
      fakeTask.cacheable = {
        key: sandbox.spy((file) => String(file.contents)),
      }

      let proxied = memoize(fakeTask)

      // write the fake file to it
      proxied.write(
        new File({
          path: '/some/path',
          contents: Buffer.from('abufferwiththiscontent')
        })
      )

      // wait for the file to come back out
      proxied.once('data', (file) =>
        proxied._flush(() => {
          // make sure it came out the same way it went in
          expect(file.isBuffer()).toEqual(true)

          // check the contents are same
          expect(String(file.contents)).toEqual(
            'abufferwiththiscontent-modified'
          )

          // Verify the cacheable options were used.
          expect(fakeTask.cacheable.key.called).toEqual(true)
          // Reset for the second run through
          fakeTask.cacheable.key.resetHistory()
          fakeFileHandler.resetHistory()
          // Refresh proxied
          proxied = memoize(fakeTask)
          // Write the same file again, should be cached result
          proxied.write(
            new File({
              path: '/some/path',
              contents: Buffer.from('abufferwiththiscontent')
            })
          )

          proxied.once('data', () =>
            proxied._flush(() => {
              expect(fakeTask.cacheable.key.called).toEqual(true)
              // Should not have called the original task
              expect(fakeFileHandler.called).toEqual(false)
              done()
            })
          )
        })
      )
    })

    it('can proxy a task using task.cacheable with user overrides', (done) => {
      // Let the task define the cacheable aspects.
      fakeTask.cacheable = {
        key: sandbox.spy((file) => String(file.contents))
      }

      const overriddenKey = sandbox.stub().returns('key')
      const opts = { key: overriddenKey }
      // write the fake file to it
      let proxied = memoize(fakeTask, opts)

      proxied.write(
        new File({
          path: '/some/path',
          contents: Buffer.from('abufferwiththiscontent'),
        })
      )

      // wait for the file to come back out
      proxied.once('data', (file) =>
        proxied._flush(() => {
          // make sure it came out the same way it went in
          expect(file.isBuffer()).toEqual(true)

          // check the contents are same
          expect(String(file.contents)).toEqual(
            'abufferwiththiscontent-modified'
          )

          // Verify the cacheable options were used.
          expect(fakeTask.cacheable.key.called).toEqual(false)
          expect(overriddenKey.called).toEqual(true)

          fakeTask.cacheable.key.resetHistory()
          overriddenKey.resetHistory()
          fakeFileHandler.resetHistory()

          // Refresh proxied
          proxied = memoize(fakeTask, opts)
          // Write the same file again, should be cached result
          proxied.write(
            new File({
              path: '/some/path',
              contents: Buffer.from('abufferwiththiscontent'),
            })
          )

          proxied.once('data', () =>
            proxied._flush(() => {
              expect(fakeTask.cacheable.key.called).toEqual(false)
              expect(overriddenKey.called).toEqual(true)

              // Should not have called the original task
              expect(fakeFileHandler.called).toEqual(false)

              done()
            })
          )
        })
      )
    })

    it('can be passed just a string for the value', (done) => {
      const opts = { value: 'ran' }
      // Create a proxied plugin stream
      let proxied = memoize(fakeTask, opts)

      proxied.write(
        new File({
          contents: Buffer.from('abufferwiththiscontent'),
        })
      )

      proxied.once('data', (file) =>
        proxied._flush(() => {
          // Check it assigned the proxied task result
          expect(file.ran).toEqual(true)

          // Refresh proxied
          proxied = memoize(fakeTask, opts)

          // Write the same file again, should be cached result
          proxied.end(
            new File({
              path: '/some/path',
              contents: Buffer.from('abufferwiththiscontent'),
            })
          )

          proxied.once('data', (secondFile) =>
            proxied._flush(() => {
              // Cached value should have been applied
              expect(secondFile.ran).toEqual(true)
              done()
            })
          )
        })
      )
    })

    it('can store changed contents of files', (done) => {
      const updatedFileHandler = sandbox.spy((file, enc, cb) => {
        file.contents = Buffer.from('updatedcontent')
        cb(null, file)
      })

      fakeTask = through.obj(updatedFileHandler)

      // Create a proxied plugin stream
      let proxied = memoize(fakeTask)

      // write the fake file to it
      proxied.write(
        new File({
          path: '/some/path',
          contents: Buffer.from('abufferwiththiscontent'),
        })
      )

      // wait for the file to come back out
      proxied.once('data', (file) =>
        proxied._flush(() => {
          // Check for updated content
          expect(String(file.contents)).toEqual('updatedcontent')

          // Check original handler was called
          expect(updatedFileHandler.called).toEqual(true)

          updatedFileHandler.resetHistory()

          // Refresh proxied
          proxied = memoize(fakeTask)

          proxied.once('data', () =>
            proxied._flush(() => {
              expect(String(file.contents)).toEqual('updatedcontent')

              // Check original handler was not called.
              expect(updatedFileHandler.called).toEqual(false)

              done()
            })
          )

          // Write the same file again, should be cached result
          proxied.write(
            new File({
              path: '/some/path',
              contents: Buffer.from('abufferwiththiscontent'),
            })
          )
        })
      )
    })

    it('does not throw memory leak warning when proxying tasks', (done) => {
      const delay = 10
      const filesCount = 30

      fakeTask = through.obj((file, enc, cb) => {
        setTimeout(() => {
          file.contents = Buffer.from(`${file.contents.toString()} updated`)

          cb(null, file)
        }, delay)
      })

      const proxied = memoize(fakeTask)
      const origMaxListeners = fakeTask._maxListeners
      const errSpy = sandbox.spy(console, 'error')
      let processedCount = 0

      proxied
        .on('data', () => {
          processedCount += 1
        })
        .on('end', () => {
          expect(processedCount).toEqual(filesCount)
          expect(errSpy.called).toEqual(false, 'Called console.error')
          expect(fakeTask._maxListeners).toEqual(origMaxListeners || 0)

          done()
        })

      Array.from({
        length: filesCount,
      }).forEach((_, i) => {
        proxied.write(
          new File({
            contents: Buffer.from(`Test File ${i}`),
          })
        )
      })

      proxied.end()
    })

    it('sets the cache based on file contents', (done) => {
      const filePath = path.join(
        process.cwd(),
        'test',
        'fixtures',
        'in',
        'file1.txt'
      )
      const otherFilePath = path.join(
        process.cwd(),
        'test',
        'fixtures',
        'in',
        'file2.txt'
      )
      const updatedFileHandler = sandbox.spy((file, enc, cb) => {
        file.contents = Buffer.from('updatedcontent')

        cb(null, file)
      })

      fakeTask = through.obj(updatedFileHandler)

      // Create a proxied plugin stream
      let proxied = memoize(fakeTask)

      // write the fake file to it
      proxied.write(
        new File({
          path: filePath,
          contents: Buffer.from('abufferwiththiscontent'),
        })
      )

      // wait for the file to come back out
      proxied.once('data', (file) =>
        proxied._flush(() => {
          // Check original handler was called
          expect(updatedFileHandler.called).toEqual(true)

          // Check the path is on there
          expect(file.path).toEqual(filePath)

          updatedFileHandler.resetHistory()

          // Refresh proxied
          proxied = memoize(fakeTask)

          // Write a file with same content but different path, should be cached result
          proxied.write(
            new File({
              path: otherFilePath,
              contents: Buffer.from('abufferwiththiscontent'),
            })
          )

          proxied.once('data', (secondFile) =>
            proxied._flush(() => {
              // Check for different file path
              expect(secondFile.path).toBeTruthy()
              expect(secondFile.path).toEqual(otherFilePath)

              // Check original handler was not called
              expect(updatedFileHandler.called).toEqual(false)

              done()
            })
          )
        })
      )
    })
  })

  it('can clear the default memo', () => {
    memoize.clearDefaultMemo()
  })
})
