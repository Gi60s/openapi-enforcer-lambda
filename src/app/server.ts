import { Context } from 'aws-lambda'
import http from 'http'
import querystring from 'querystring'
import { LambdaEvent, LambdaHandler, LambdaResult } from './index'

// This is a very lightweight server that translates between requests using http and lambda.
// This server is not intended for use in production. Instead, it is useful for testing using
// Postman or some other interface that wants to talk to our locally running lambda via http.

export interface ServerConfiguration {
  handler: LambdaHandler
  listener: http.Server | null
  port: number
  server: http.Server
}

export type ServerBodyParser = (contentType: string, req: http.IncomingMessage, event: LambdaEvent) => Promise<void>

export interface ServerOptions {
  bodyParser: ServerBodyParser
}

const map: WeakMap<Server, ServerConfiguration> = new WeakMap()

export class Server {
  constructor (port: number, handler: LambdaHandler, options?: ServerOptions) {
    const server = http.createServer((req, res) => {
      const [path, query] = (req.url ?? '/').split('?')
      const qsData = parseParameters(querystring.parse(query))
      const headerData = parseParameters(req.headers)

      const event: LambdaEvent = {
        body: null,
        headers: headerData.single,
        httpMethod: req.method?.toUpperCase() ?? 'GET',
        isBase64Encoded: false,
        path,
        queryStringParameters: qsData.single,
        requestContext: {
          elb: { targetGroupArn: '' }
        },
        multiValueHeaders: headerData.multi,
        multiValueQueryStringParameters: qsData.multi
      }

      const contentType = headerData.single['content-type']
      if (contentType === 'application/json' || contentType === 'application/x-www-form-urlencoded' || contentType === 'text/plain') {
        event.body = ''
        req.on('data', chunk => {
          event.body = (event.body as string) + String(chunk.toString())
        })
        req.on('end', () => {
          runLambda(event, res, handler)
        })
      } else if (contentType !== undefined && options?.bodyParser !== undefined) {
        options.bodyParser(contentType, req, event)
          .then(() => {
            runLambda(event, res, handler)
          })
          .catch(e => {
            console.error(e)
            runLambda(event, res, handler)
          })
      } else {
        runLambda(event, res, handler)
      }
    })

    const config: ServerConfiguration = {
      handler,
      listener: null,
      port,
      server
    }
    map.set(this, config)
  }

  get port (): number {
    const data = map.get(this)
    if (data === undefined) throw Error('Invalid execution context')

    const listener = data.listener
    if (listener === null) return data.port

    const address = listener.address()
    return address !== null && typeof address === 'object' ? address.port : data.port
  }

  async start (): Promise<Server> {
    const data = map.get(this)
    if (data === undefined) throw Error('Invalid execution context')
    return await new Promise((resolve, reject) => {
      if (data.listener === null) {
        data.listener = data.server.listen(data.port, () => {
          resolve(this)
        })
      } else {
        resolve(this)
      }
    })
  }

  async stop (): Promise<Server> {
    const data = map.get(this)
    if (data === undefined) throw Error('Invalid execution context')
    return await new Promise((resolve, reject) => {
      if (data.listener === null) {
        resolve(this)
      } else {
        data.listener.close(err => {
          if (err !== undefined) return reject(err)
          resolve(this)
        })
        data.listener = null
      }
    })
  }
}

function parseParameters (params: Record<string, string | string[] | undefined>): { single: Record<string, string>, multi: Record<string, string[]> } {
  const single: Record<string, string> = {}
  const multi: Record<string, string[]> = {}
  Object.keys(params).forEach(key => {
    const value = params[key]
    if (Array.isArray(value)) {
      multi[key] = value
    } else if (value !== undefined) {
      single[key] = value
    }
  })
  return {
    single,
    multi
  }
}

function runLambda (event: LambdaEvent, res: http.ServerResponse, handler: LambdaHandler): void {
  const context: Context = {
    awsRequestId: '',
    callbackWaitsForEmptyEventLoop: false,
    functionName: '',
    functionVersion: '',
    invokedFunctionArn: '',
    logGroupName: '',
    logStreamName: '',
    memoryLimitInMB: '',
    done (_error?: Error, _result?: any): void {},
    fail (_error: Error | string): void {},
    succeed (_messageOrObject: any, _object?: any): void {},
    getRemainingTimeInMillis (): number { return 5000 }
  }

  handler(event, context)
    .then(result => {
      send(res, result)
    })
    .catch(e => {
      console.error(e)
      res.statusCode = 500
      res.write('Internal server error')
      res.end()
    })
}

function send (res: http.ServerResponse, result: LambdaResult): void {
  res.statusCode = result.statusCode

  if (result.headers !== undefined) {
    Object.keys(result.headers).forEach(key => {
      res.setHeader(key, result.headers?.[key] as string)
    })
  }
  if (result.multiValueHeaders !== undefined) {
    Object.keys(result.multiValueHeaders).forEach(key => {
      res.setHeader(key, result.multiValueHeaders?.[key] as string[])
    })
  }

  if (result.body !== undefined) res.write(result.body)

  res.end()
}
