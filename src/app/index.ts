import { APIGatewayProxyEvent, APIGatewayProxyResult, ALBEvent, ALBResult, Context } from 'aws-lambda'
import path from 'path'
import { Enforcer } from 'openapi-enforcer'
import querystring from 'querystring'

const rxContentType = /^content-type$/i

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

export interface EnforcerLambda {
  handler: (handler: Handler) => LambdaHandler
  route: (controllers: RouteControllerMap) => LambdaHandler
}

export type Handler = (req: Request, res: Response) => Promise<void>

type Headers = MergedParameters

export type LambdaEvent = APIGatewayProxyEvent | ALBEvent

export type LambdaHandler = (event: LambdaEvent, context: Context) => Promise<LambdaResult>

export type LambdaResult = APIGatewayProxyResult | ALBResult

interface OperationsMapData {
  xController: string
  xOperation: string
  processed: boolean
}

export interface Options {
  allowOtherQueryParameters?: boolean | string[]
  bodyParser?: (contentType: string, body: string) => string | object
  enforcerOptions?: Record<string, any>
  handleBadRequest?: boolean
  handleBadResponse?: boolean
  handleNotFound?: boolean
  handleMethodNotAllowed?: boolean
  logErrors?: boolean
  xController?: string
  xOperation?: string
}

type MergedParameters = Record<string, string | string[] | undefined>

export interface Request {
  body?: string | object
  cookies: Record<string, any>
  context: Context
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

export interface TestRequest {
  method?: string
  path: string
  headers?: Headers
  body?: string | object
}

export interface TestResponse {
  body: string | object
  headers: Headers
  statusCode: number
}

export default function enforcerLambda (openapi: string | unknown, options: Options = {}): EnforcerLambda {
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
      return async function (event: LambdaEvent, context: Context) {
        try {
          const { req, res, result } = await initialize(event, context, openapi, options)
          await handler(req, res)
          return sendValidResponse(req.response, result)
        } catch (e) {
          return sendErrorResponse(e, options)
        }
      }
    },

    route (controllers: RouteControllerMap): LambdaHandler {
      return async function (event: LambdaEvent, context: Context) {
        try {
          const { req, res, result } = await initialize(event, context, openapi, options)
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

export async function test (handler: LambdaHandler, req: TestRequest): Promise<TestResponse> {
  const [path, qs] = req.path.split('?')
  const method = req.method?.toUpperCase() ?? 'GET'
  const [headers, multiValueHeaders] = splitMultiValueParameters(req.headers)
  const [queryStringParameters, multiValueQueryStringParameters] = splitMultiValueParameters(qs !== undefined ? querystring.parse(qs) : {})
  const bodyIsObject = req.body !== null && typeof req.body === 'object'
  let body: string | null = req.body as string ?? null

  if (bodyIsObject) {
    const contentType = getContentTypeFromHeaders(headers)
    if (contentType === undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(req.body)
    } else if (contentType === 'application/json') {
      body = JSON.stringify(req.body)
    } else if (contentType === 'application/x-www-form-urlencoded') {
      body = querystring.stringify(req.body as any)
    }
  }

  const event: LambdaEvent = {
    body,
    headers,
    httpMethod: method,
    isBase64Encoded: false,
    multiValueHeaders,
    multiValueQueryStringParameters,
    path,
    pathParameters: null,
    queryStringParameters,
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
      protocol: 'https',
      httpMethod: method,
      path,
      stage: '',
      requestId: '',
      requestTimeEpoch: Date.now(),
      resourceId: '',
      resourcePath: ''
    },
    resource: '',
    stageVariables: null
  }

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

  const res = await handler(event, context)

  const resSingleHeaders = convertResponseHeaders(res.headers) as Record<string, string>
  const resMultiHeaders = convertResponseHeaders(res.multiValueHeaders) as Record<string, string[]>
  const resHeaders = mergeMultiValueParameters(resSingleHeaders, resMultiHeaders)
  const resBody = (() => {
    try {
      return typeof res.body === 'string' ? JSON.parse(res.body) : null
    } catch (e) {
      return res.body ?? null
    }
  })()
  return {
    body: resBody,
    headers: resHeaders,
    statusCode: res.statusCode
  }
}

export function testSuite (handler: LambdaHandler): (req: TestRequest) => Promise<TestResponse> {
  return async function (req: TestRequest): Promise<TestResponse> {
    return await test(handler, req)
  }
}

function convertResponseHeaders (headers: Record<string, boolean | number | string | Array<boolean | number | string>> | undefined): Record<string, string | string[]> | undefined {
  if (headers === undefined) return
  const result: Record<string, string | string[]> = {}
  Object.keys(headers).forEach(key => {
    result[key] = String(headers[key])
  })
  return result
}

function getContentTypeFromHeaders (headers: Record<string, string | undefined> | undefined): string | undefined {
  if (headers === undefined) return

  const headerKeys = Object.keys(headers)
  const contentTypeKey = headerKeys.find(v => rxContentType.test(v))
  if (contentTypeKey === undefined) return

  return Array.isArray(headers[contentTypeKey])
    ? headers[contentTypeKey]?.[0]
    : headers[contentTypeKey] as string
}

async function initialize (event: LambdaEvent, context: Context, openapi: Promise<any> | any, options: Options): Promise<{ req: Request, res: Response, result: ResponseResult }> {
  if (openapi instanceof Promise) {
    try {
      openapi = await openapi
    } catch (e) {
      throw new EnforcerStatusError(500, e.toString())
    }
  }

  // get all query parameters into a single map
  const qsMap: Record<string, string[]> = {}
  const query: Record<string, string | string[]> = {}
  let hasQs = false
  if (event.queryStringParameters !== null) {
    const qsParams = event.queryStringParameters ?? {}
    Object.keys(qsParams).forEach(key => {
      qsMap[key] = [qsParams[key] ?? '']
      query[key] = qsParams[key] ?? ''
      hasQs = true
    })
  }
  if (event.multiValueQueryStringParameters !== null) {
    const qsParams = event.multiValueQueryStringParameters ?? {}
    Object.keys(qsParams).forEach(key => {
      qsMap[key] = qsParams[key] ?? ['']
      query[key] = qsParams[key] ?? ['']
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

  // add json and form-urlencoded body parsers
  let body: string | object | undefined
  if (event.body !== null && event.body !== undefined) {
    const contentType = getContentTypeFromHeaders(event.headers)
    if (contentType === 'application/json') {
      try {
        body = JSON.parse(event.body)
      } catch (e) {
        throw new EnforcerStatusError(400, 'Invalid JSON body')
      }
    } else if (contentType === 'application/x-www-form-urlencoded') {
      try {
        body = querystring.parse(event.body)
      } catch (e) {
        throw new EnforcerStatusError(400, 'Invalid form-urlencoded body')
      }
    } else if (options.bodyParser !== undefined) {
      try {
        body = options.bodyParser(contentType ?? '', event.body)
      } catch (e) {
        throw new EnforcerStatusError(400, e.message)
      }
    }
  }

  // validate and process the request
  const requestOptions = options.allowOtherQueryParameters !== undefined ? { allowOtherQueryParameters: options.allowOtherQueryParameters } : {}
  const method = event.httpMethod.toLowerCase()
  const headers = mergeMultiValueParameters(event.headers ?? {}, event.multiValueHeaders ?? {})
  const [req, error] = openapi.request({
    method,
    path: event.path + queryString,
    headers,
    ...(body !== undefined ? { body } : {})
  }, requestOptions)
  if (error !== undefined) throw new EnforcerStatusError(error.statusCode, error.toString())

  return {
    req: {
      ...(req.body !== undefined ? { body: req.body } : {}), // add the body if it was included
      cookies: Object.assign({}, req.cookie ?? {}),
      context,
      headers: Object.assign(headers, req.headers ?? {}),
      method,
      operation: req.operation,
      params: req.path ?? {},
      path: event.path,
      pathKey: req.pathKey,
      query: Object.assign(query, req.query ?? {}),
      response: req.response
    },
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

function mergeMultiValueParameters (singles: Record<string, string | undefined>, multis: Record<string, string[] | undefined>): MergedParameters {
  const merged: MergedParameters = {}
  if (singles !== undefined) {
    Object.keys(singles).forEach(key => {
      merged[key] = singles[key]
    })
  }
  if (multis !== undefined) {
    Object.keys(multis).forEach(key => {
      merged[key] = multis[key]
    })
  }
  return merged
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

function splitMultiValueParameters (data: MergedParameters | undefined): [Record<string, string>, Record<string, string[]>] {
  const singles: Record<string, string> = {}
  const multis: Record<string, string[]> = {}
  Object.keys(data ?? {}).forEach(key => {
    const value: any = data?.[key]
    if (typeof value === 'string') {
      singles[key] = value
    } else if (Array.isArray(value)) {
      multis[key] = value
    }
  })
  return [singles, multis]
}
