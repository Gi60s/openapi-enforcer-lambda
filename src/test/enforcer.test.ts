import { expect } from 'chai'
import { handler, route, test, Server, Options } from '../app'
import http from 'http'
import path from 'path'

const oasPath = path.resolve(__dirname, '../../resources/openapi.yml')
const options = { logErrors: false, enforcerOptions: { hideWarnings: true } }

describe('enforcer-lambda', () => {
  describe('handler', () => {
    it('it will run handler if request is valid', async () => {
      let count = 0
      const h = handler(oasPath, async (req, res) => {
        count++
        res.status(200).send({ id: 123, name: 'Name' })
      }, options)
      const result = await test(h, { path: '/accounts/123' })
      expect(count).to.equal(1)
      expect(result.statusCode).to.equal(200)
    })

    it('return a 404 for invalid path', async () => {
      let count = 0
      const h = handler(oasPath, async (req, res) => {
        count++
        res.status(200).send({ id: 123, name: 'Name' })
      }, options)
      const result = await test(h, { path: '/foo' })
      expect(count).to.equal(0)
      expect(result.statusCode).to.equal(404)
    })

    it('return a 400 for invalid input parameters', async () => {
      let count = 0
      const h = handler(oasPath, async (req, res) => {
        count++
        res.status(200).send({ id: 123, name: 'Name' })
      }, options)
      const result = await test(h, { path: '/accounts/abc' })
      expect(count).to.equal(0)
      expect(result.statusCode).to.equal(400)
    })

    it('will not allow undefined query parameters by default', async () => {
      let count = 0
      const h = handler(oasPath, async (req, res) => {
        count++
        res.status(200).send({ id: 123, name: 'Name' })
      }, options)
      const result = await test(h, { path: '/accounts/123?foo=bar' })
      expect(count).to.equal(0)
      expect(result.statusCode).to.equal(400)
    })

    it('will allow undefined query parameters if allowed', async () => {
      let count = 0
      const options: Options = {
        allowOtherQueryParameters: true,
        logErrors: false,
        enforcerOptions: {
          hideWarnings: true
        }
      }
      const h = handler(oasPath, async (req, res) => {
        count++
        res.status(200).send({ id: 123, name: 'Name' })
      }, options)
      const result = await test(h, { path: '/accounts/123?foo=bar' })
      expect(count).to.equal(1)
      expect(result.statusCode).to.equal(200)
    })

    it('will require a response to be valid', async () => {
      let count = 0
      const h = handler(oasPath, async (req, res) => {
        count++
        res.status(200).send({ id: 'abc' })
      }, options)
      const result = await test(h, { path: '/accounts/123' })
      expect(count).to.equal(1)
      expect(result.statusCode).to.equal(500)
    })
  })

  describe('router', () => {
    it('it will run route if request is valid', async () => {
      let count = 0
      const h = route(oasPath, {
        accounts: {
          getAccount: async (req, res) => {
            count++
            res.status(200).send({ id: 123, name: 'Name' })
          }
        }
      }, options)
      const result = await test(h, { path: '/accounts/123' })
      expect(count).to.equal(1)
      expect(result.statusCode).to.equal(200)
    })

    it('will return a 404 for an invalid path', async () => {
      let count = 0
      const h = route(oasPath, {
        accounts: {
          getAccount: async (req, res) => {
            count++
            res.status(200).send({ id: 123, name: 'Name' })
          }
        }
      }, options)
      const result = await test(h, { path: '/messages/123' })
      expect(count).to.equal(0)
      expect(result.statusCode).to.equal(404)
    })

    it('return a 400 for invalid input parameters', async () => {
      let count = 0
      const h = route(oasPath, {
        accounts: {
          getAccount: async (req, res) => {
            count++
            res.status(200).send({ id: 123, name: 'Name' })
          }
        }
      }, options)
      const result = await test(h, { path: '/accounts/abc' })
      expect(count).to.equal(0)
      expect(result.statusCode).to.equal(400)
    })

    it('undefined query parameters not allowed', async () => {
      let count = 0
      const h = route(oasPath, {
        accounts: {
          getAccount: async (req, res) => {
            count++
            res.status(200).send({ id: 123, name: 'Name' })
          }
        }
      }, options)
      const result = await test(h, { path: 'accounts/123?foo=bar' })
      expect(count).to.equal(0)
      expect(result.statusCode).to.equal(400)
    })

    it('undefined query parameters allowed', async () => {
      let count = 0
      const options: Options = {
        allowOtherQueryParameters: true,
        logErrors: false,
        enforcerOptions: {
          hideWarnings: true
        }
      }
      const h = route(oasPath, {
        accounts: {
          getAccount: async (req, res) => {
            count++
            res.status(200).send({ id: 123, name: 'Name' })
          }
        }
      }, options)
      const result = await test(h, { path: 'accounts/123?foo=bar' })
      expect(count).to.equal(1)
      expect(result.statusCode).to.equal(200)
    })

    it('will require a response to be valid', async () => {
      let count = 0
      const h = route(oasPath, {
        accounts: {
          getAccount: async (req, res) => {
            count++
            res.status(200).send({ id: 123 })
          }
        }
      }, options)
      const result = await test(h, { path: 'accounts/123' })
      expect(count).to.equal(1)
      expect(result.statusCode).to.equal(500)
    })
  })

  describe('body parser', () => {
    it('will auto-parse valid json', async () => {
      const h = handler(oasPath, async (req, res) => {
        const body = req.body as { name: string }
        res.status(201).send({ id: 123, name: body.name })
      }, options)
      const result = await test(h, {
        method: 'post',
        path: '/accounts',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Bob' })
      })
      expect(result.statusCode).to.equal(201)
      expect((result.body as { name: string }).name).to.equal('Bob')
    })

    it('will auto-parse valid x-www-form-urlencoded', async () => {
      const h = handler(oasPath, async (req, res) => {
        const body = req.body as { name: string }
        res.status(201).send({ id: 123, name: body.name })
      }, options)
      const result = await test(h, {
        method: 'post',
        path: '/accounts',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'name=Bob'
      })
      expect(result.statusCode).to.equal(201)
      expect((result.body as { name: string }).name).to.equal('Bob')
    })

    it('will use provided body parser if not json or form url encoded', async () => {
      const options: Options = {
        bodyParser (type, body) {
          return {
            name: type + ':' + body
          }
        },
        logErrors: false,
        enforcerOptions: { hideWarnings: true }
      }
      const h = handler(oasPath, async (req, res) => {
        res.status(201).send({ id: 123, name: (req.body as { name: string }).name })
      }, options)
      const result = await test(h, {
        method: 'post',
        path: '/accounts',
        headers: { 'content-type': 'application/fake' },
        body: 'foo-bar'
      })
      expect(result.statusCode).to.equal(201)
      expect((result.body as { name: string }).name).to.equal('application/fake:foo-bar')
    })
  })

  describe('server', () => {
    let server: Server

    beforeEach(async () => {
      const h = handler(oasPath, async (req, res) => {
        res.status(200)
          .set('x-custom-header', 'custom')
          .send({ id: 123, name: 'Bob' })
      }, options)

      server = new Server(0, h)
      await server.start()
    })

    afterEach(async () => {
      return await server.stop()
    })

    it('can proxy server requests', (done) => {
      http.get('http://localhost:' + String(server.port) + '/accounts/123', res => {
        try {
          expect(res.statusCode).to.equal(200)
          expect(res.headers['x-custom-header']).to.equal('custom')

          res.setEncoding('utf8')
          let rawData = ''
          res.on('data', (chunk: string) => {
            rawData += chunk
          })
          res.on('end', () => {
            try {
              const data = JSON.parse(rawData)
              expect(data).to.deep.equal({ id: 123, name: 'Bob' })
              done()
            } catch (e) {
              done(e)
            }
          })
        } catch (e) {
          done(e)
        }
      })
    })
  })
})
