import { expect } from 'chai'
import { default as enforcer, handler, route, LambdaEvent, Options } from '../index'
import path from 'path'
import exp from "constants";

const oasPath = path.resolve(__dirname, '../../resources/openapi.yml')
const options = { logErrors: false, enforcerOptions: { hideWarnings: true } }

describe('enforcer-lambda', () => {
    describe('handler', () => {

        it('it will run handler if request is valid', async () => {
            let count = 0
            const h = handler(oasPath, options, async (req, res) => {
                count++
                res.status(200).send({ id: 123, name: 'Name' })
            })
            const result = await h(event('get', '/accounts/123'))
            expect(count).to.equal(1)
            expect(result.statusCode).to.equal(200)
        })

        it('return a 404 for invalid path', async () => {
            let count = 0
            const h = handler(oasPath, options, async (req, res) => {
                count++
                res.status(200).send({ id: 123, name: 'Name' })
            })
            const result = await h(event('get', '/foo'))
            expect(count).to.equal(0)
            expect(result.statusCode).to.equal(404)
        })

        it('return a 400 for invalid input parameters', async () => {
            let count = 0
            const h = handler(oasPath, options, async (req, res) => {
                count++
                res.status(200).send({ id: 123, name: 'Name' })
            })
            const result = await h(event('get', '/accounts/abc'))
            expect(count).to.equal(0)
            expect(result.statusCode).to.equal(400)
        })

        it('will not allow undefined query parameters by default', async () => {
            let count = 0
            const h = handler(oasPath, options, async (req, res) => {
                count++
                res.status(200).send({ id: 123, name: 'Name' })
            })
            const result = await h(event('get', '/accounts/123?foo=bar'))
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
            const h = handler(oasPath, options, async (req, res) => {
                count++
                res.status(200).send({ id: 123, name: 'Name' })
            })
            const result = await h(event('get', '/accounts/123?foo=bar'))
            expect(count).to.equal(1)
            expect(result.statusCode).to.equal(200)
        })

        it('will require a response to be valid', async () => {
            let count = 0
            const h = handler(oasPath, options, async (req, res) => {
                count++
                res.status(200).send({ id: 'abc' })
            })
            const result = await h(event('get', '/accounts/123'))
            expect(count).to.equal(1)
            expect(result.statusCode).to.equal(500)
        })

    })

    describe('router', () => {
        it('it will run route if request is valid', async () => {
            let count = 0
            const h = route(oasPath, options, {
                accounts: {
                    getAccount: async (req, res) => {
                        count++
                        res.status(200).send({ id: 123, name: 'Name' })
                    }
                }
            })
            const result = await h(event('get', '/accounts/123'))
            expect(count).to.equal(1)
            expect(result.statusCode).to.equal(200)
        })

        it('will return a 404 for an invalid path', async () => {
            let count = 0
            const h = route(oasPath, options, {
                accounts: {
                    getAccount: async (req, res) => {
                        count++
                        res.status(200).send({id: 123, name: 'Name'})
                    }
                }
            })
            const result = await h(event('get', '/messages/123'))
            expect(count).to.equal(0)
            expect(result.statusCode).to.equal(404)
        })

        it('return a 400 for invalid input parameters', async () => {
            let count = 0
            const h = route(oasPath, options, {
                accounts: {
                    getAccount: async(req, res) => {
                        count++
                        res.status(200).send({id: 123, name: 'Name'})
                    }
                }
            })
            const result = await h(event('get', '/accounts/abc'))
            expect(count).to.equal(0)
            expect(result.statusCode).to.equal(400)
        })

        it('undefined query parameters not allowed', async () => {
            let count = 0
            const h = route(oasPath, options, {
                accounts: {
                    getAccount: async(req, res) => {
                        count++
                        res.status(200).send({id: 123, name: 'Name'})
                    }
                }
            })
            const result = await h(event('get', 'accounts/123?foo=bar'))
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
            const h = route(oasPath, options, {
                accounts: {
                    getAccount: async(req, res) => {
                        count++
                        res.status(200).send({id: 123, name: 'Name'})
                    }
                }
            })
            const result = await h(event('get', 'accounts/123?foo=bar'))
            expect(count).to.equal(1)
            expect(result.statusCode).to.equal(200)
        })

        it('will require a response to be valid', async () => {
            let count = 0
            const h = route(oasPath, options, {
                accounts: {
                    getAccount: async(req, res) => {
                        count++
                        res.status(200).send({id: 123})
                    }
                }
            })
            const result = await h(event('get', 'accounts/123'))
            expect(count).to.equal(1)
            expect(result.statusCode).to.equal(500)
        })
    })
})

function event (method: string, path: string, data?: Partial<LambdaEvent>): LambdaEvent {
    return {
        httpMethod: method.toUpperCase(),
        path,
        body: data?.body ?? null,
        headers: data?.headers ?? {},
        isBase64Encoded: false,
        multiValueHeaders: {},
        multiValueQueryStringParameters: {},
        pathParameters: null,
        queryStringParameters: data?.queryStringParameters ?? {},
        requestContext: {
            accountId: '',
            apiId: '',
            authorizer: {},
            identity: {
                accessKey: null,
                accountId: null,
                apiKey: null,
                apiKeyId: null,
                caller: null,
                clientCert: null,
                cognitoAuthenticationProvider: null,
                cognitoAuthenticationType: null,
                cognitoIdentityId: null,
                cognitoIdentityPoolId: null,
                principalOrgId: null,
                sourceIp: '',
                user: null,
                userAgent: null,
                userArn: null
            },
            protocol: 'http',
            httpMethod: method.toUpperCase(),
            path,
            stage: '',
            requestId: '',
            requestTimeEpoch: Date.now(),
            resourceId: '',
            resourcePath: ''
        },
        resource: "",
        stageVariables: null
    }
}