import { expect } from 'chai'
import { handler, route, test, Options } from '../app'
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
})
