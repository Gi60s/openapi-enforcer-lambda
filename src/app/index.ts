import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import path from 'path'
import { Enforcer } from 'openapi-enforcer'

process.on('unhandledRejection', (e) => {
  console.log(e)
  process.exit(1)
})

export interface CookieOptions {
  domain?: string
  encode?: Function
  expires?: Date
  httpOnly?: boolean
  maxAge?: number
  path?: string
  secure?: boolean
  signed?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
}

export type Handler = (req: unknown, res: Response) => Promise<void>

export type LambdaEvent = APIGatewayProxyEvent

export type LambdaHandler = (event: LambdaEvent) => Promise<LambdaResult>

export type LambdaResult = APIGatewayProxyResult

interface OperationsMapData {
  xController: string
  xOperation: string
  processed: boolean
}

export interface Options {
  allowOtherQueryParameters?: boolean | string[]
  enforcerOptions?: Record<string, any>
  handleBadRequest?: boolean
  handleBadResponse?: boolean
  handleNotFound?: boolean
  handleMethodNotAllowed?: boolean
  logErrors?: boolean
  xController?: string
  xOperation?: string
}

export interface Request {
  body: string | object
  cookie: Record<string, any>
  headers: Record<string, any>
  method: string
  operation: any
  params: Record<string, any>
  path: string
  pathKey: string
  query: Record<string, any>
  response: any
}

export interface Response {
  cookie: (name: string, value: string | object, options?: CookieOptions) => Response
  clearCookie: (name: string) => void
  get: (header: string) => string | number | boolean | undefined
  redirect: (location: string, code?: number) => Response
  send: (data?: string | object) => Response
  set: (header: string, value: string | number | boolean) => Response
  status: (code: number) => Response
}

interface ResponseResult {
  statusCode: number
  headers: Record<string, string | number | boolean>
  isBase64Encoded: boolean
  multiValueHeaders: Record<string, Array<string | number | boolean>>
  body: string | object | undefined
}

export interface RouteControllerMap {
  [controller: string]: {
    [operation: string]: (req: Request, res: Response) => Promise<void>
  }
}

export default function enforcerLambda (openapi: string | unknown, options: Options = {}): { handler: (handler: Handler) => LambdaHandler, route: (controllers: RouteControllerMap) => LambdaHandler } {
  if (options.allowOtherQueryParameters === undefined) options.allowOtherQueryParameters = false
  if (options.handleBadRequest === undefined) options.handleBadRequest = true
  if (options.handleBadResponse === undefined) options.handleBadResponse = true
  if (options.handleNotFound === undefined) options.handleNotFound = true
  if (options.handleMethodNotAllowed === undefined) options.handleMethodNotAllowed = true
  if (options.logErrors === undefined) options.logErrors = true
  if (options.xController === undefined) options.xController = 'x-controller'
  if (options.xOperation === undefined) options.xOperation = 'x-operation'

  if (typeof openapi === 'string') {
    const fullPath = path.resolve(process.cwd(), openapi)
    openapi = Enforcer(fullPath, options.enforcerOptions ?? {})
  }
  const operationsMap: Map<any, OperationsMapData> = new Map()

  return {
    handler (handler: Handler): LambdaHandler {
      return async function (event: LambdaEvent) {
        try {
          const { req, res, result } = await initialize(event, openapi, options)
          await handler(req, res)
          return sendValidResponse(req.response, result)
        } catch (e) {
          return sendErrorResponse(e, options)
        }
      }
    },

    route (controllers: RouteControllerMap): LambdaHandler {
      return async function (event: LambdaEvent) {
        try {
          const { req, res, result } = await initialize(event, openapi, options)
          const { method, path, operation } = req

          // get the x-controller and x-operation for the operation
          const registered: OperationsMapData = operationsMap.get(operation) ?? { xOperation: '', xController: '', processed: false }
          if (!registered.processed) {
            operationsMap.set(operation, registered)
            registered.xOperation = operation[options?.xOperation as string] ?? operation.operationId ?? ''
            let node = operation
            while (node !== null) {
              const xController = options?.xController as string
              if (xController in node) {
                registered.xController = node[xController]
                break
              }
              node = node.enforcerData.parent.result ?? null
            }
          }

          if (registered.xController === '' || registered.xOperation === '') {
            const xOperation: string = options?.xOperation ?? ''
            const xController: string = options?.xController ?? ''
            throw new EnforcerRouterError('NO_ROUTE_MAPPING', 'The OpenAPI document defines the "' + method.toUpperCase() + ' ' + path +
              '" endpoint, but the endpoint has no route mapping. Ensure that the OpenAPI document defines both the "' +
              xOperation + '" (or operationId) and "' + xController + '" properties.')
          } else if (controllers[registered.xController] === undefined) {
            throw new EnforcerRouterError('CONTROLLER_NOT_FOUND', 'The mapped controller could not be found for the "' + registered.xController + '" controller.')
          } else if (controllers[registered.xController][registered.xOperation] === undefined) {
            throw new EnforcerRouterError('CONTROLLER_NOT_FOUND', 'The mapped controller could not be found for the "' + registered.xOperation + '" operation.')
          } else {
            await controllers[registered.xController][registered.xOperation](req, res)
            return sendValidResponse(req.response, result)
          }
        } catch (e) {
          return sendErrorResponse(e, options)
        }
      }
    }
  }
}

export class EnforcerRouterError extends Error {
  public readonly code: string

  constructor (code: string, message: string) {
    super(message)
    this.code = code
  }

  toString (): string {
    return 'RouteError ' + this.code + ': ' + this.message
  }
}

export class EnforcerStatusError extends Error {
  public readonly code: number

  constructor (code: number, message: string) {
    super(message)
    this.code = code
  }

  toString (): string {
    return `StatusError ${this.code}: ${this.message}`
  }
}

export function handler (openapi: string | unknown, handler: Handler, options: Options = {}): LambdaHandler {
  const e = enforcerLambda(openapi, options)
  return e.handler(handler)
}

export function route (openapi: string | unknown, controllers: RouteControllerMap, options: Options = {}): LambdaHandler {
  const e = enforcerLambda(openapi, options)
  return e.route(controllers)
}

async function initialize (event: LambdaEvent, openapi: Promise<any> | any, options: Options): Promise<{ req: Request, res: Response, result: ResponseResult }> {
  if (openapi instanceof Promise) {
    try {
      openapi = await openapi
    } catch (e) {
      throw new EnforcerStatusError(500, e.toString())
    }
  }

  // get all query parameters into a single map
  const qsMap: Record<string, string[]> = {}
  let hasQs = false
  if (event.queryStringParameters !== null) {
    const qsParams = event.queryStringParameters
    Object.keys(qsParams).forEach(key => {
      qsMap[key] = [qsParams[key] ?? '']
      hasQs = true
    })
  }
  if (event.multiValueQueryStringParameters !== null) {
    const qsParams = event.multiValueQueryStringParameters
    Object.keys(qsParams).forEach(key => {
      qsMap[key] = qsParams[key] ?? ['']
      hasQs = true
    })
  }
  const queryString: string = hasQs
    ? '?' + Object.keys(qsMap)
      .map(key => qsMap[key].map(v => encodeURIComponent(v)).join('&'))
      .join('&')
    : ''

  // create response result object for storing data
  const result: ResponseResult = {
    statusCode: 200,
    headers: {},
    isBase64Encoded: false,
    multiValueHeaders: {},
    body: undefined
  }

  // validate and process the request
  const requestOptions = options.allowOtherQueryParameters !== undefined ? { allowOtherQueryParameters: options.allowOtherQueryParameters } : {}
  const [req, error] = openapi.request({
    method: event.httpMethod.toLowerCase(),
    path: event.path + queryString,
    headers: event.headers,
    ...(event.body !== null ? { body: event.body } : {})
  }, requestOptions)
  if (error !== undefined) throw new EnforcerStatusError(error.statusCode, error.toString())

  return {
    req,
    res: {
      cookie (name: string, value: string | object, options?: CookieOptions): Response {
        if (options === undefined) options = {}
        const encode = options.encode ?? encodeURIComponent
        if (result.multiValueHeaders['set-cookie'] === undefined) result.multiValueHeaders['set-cookie'] = []
        const valueString: string = encode(typeof value === 'string' ? value : JSON.stringify(value))
        result.multiValueHeaders['set-cookie'].push(
          name + ':' + valueString +
          '; path=' + (options.path !== undefined ? options.path : '/') +
          (options.domain !== undefined ? '; domain=' + options.domain : '') +
          (options.maxAge !== undefined ? `; max-age=${Math.round(options.maxAge / 1000)}` : '') +
          (options.expires !== undefined ? '; expires=' + options.expires.toUTCString() : '') +
          (options.secure === true ? '; secure' : '') +
          (options.sameSite !== undefined ? '; samesite=' + options.sameSite : '')
        )
        return this
      },
      clearCookie (name: string): Response {
        if (result.multiValueHeaders['set-cookie'] !== undefined) {
          const index = result.multiValueHeaders['set-cookie'].findIndex((v) => (v as string).startsWith(name + '='))
          if (index !== -1) result.multiValueHeaders['set-cookie'].splice(index, 1)
        }
        return this
      },
      get (header: string): string | number | boolean | undefined {
        return result.headers?.[header]
      },
      redirect (location: string, code?: number): Response {
        return this.status(code ?? 302).set('location', location)
      },
      send (data?: string | object): Response {
        if (arguments.length > 0) result.body = data
        return this
      },
      set (header: string, value: string | number | boolean): Response {
        result.headers[header] = value
        return this
      },
      status (code: number): Response {
        result.statusCode = code
        return this
      }
    },
    result
  }
}

function sendErrorResponse (e: Error, options?: Options): LambdaResult {
  if (options?.logErrors ?? true) console.log(e?.stack ?? e)
  if (e instanceof EnforcerStatusError) {
    return {
      statusCode: e.code,
      headers: {
        content: 'text/plain'
      },
      isBase64Encoded: false,
      multiValueHeaders: {},
      body: e.toString()
    }
  } else {
    return {
      statusCode: 500,
      headers: {
        content: 'text/plain'
      },
      isBase64Encoded: false,
      multiValueHeaders: {},
      body: 'Internal server error'
    }
  }
}

function sendValidResponse (responseProcessor: (code: number, body?: string | object | undefined, headers?: Record<string, string | boolean | number>) => any, result: ResponseResult): LambdaResult {
  const [response, error] = responseProcessor(result.statusCode, result.body, result.headers)
  if (error !== undefined) {
    const message: string = error.toString() ?? ''
    throw new EnforcerStatusError(500, `Invalid response: ${message}`)
  } else {
    return {
      statusCode: result.statusCode,
      headers: response.headers,
      isBase64Encoded: false,
      multiValueHeaders: result.multiValueHeaders,
      body: result.body === undefined
        ? ''
        : typeof result.body === 'object' ? JSON.stringify(result.body) : result.body
    }
  }
}
