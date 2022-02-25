
## Contents

- [Installation](#installation)
- [Documentation](#documentation)
  - [Enforcer Lambda](#enforcer-lambda)
  - [Handler](#handler)
  - [Router](#router)
  - [Test](#test)
  - [Test Suite](#test-suite)
- [Examples](#examples)
  - [Simple Handler](#simple-handler)
  - [Simple Router](#simple-router)
  - [Example with More Control](#example-with-more-control)
  - [Testing a Handler Once](#testing-a-handler-once)
  - [Testing a Handler More Than Once](#testing-a-handler-more-than-once)
  - [Simple HTTP Dev Server](#simple-http-dev-server)

## Installation

This library has a peer dependency on the `openapi-enforcer` package.

```shell
npm install openapi-enforcer-lambda openapi-enforcer
```

## Documentation

### Enforcer Lambda

`enforcerLambda (openapi: string | unknown, options: Options = {}): { handler: (handler: Handler) => LambdaHandler, route: (controllers: RouteControllerMap) => LambdaHandler }`

TLDR; Returns an enforcer object with a handler and a router. The handler gives you a req and a res
object to use as you will, the router will manage the event and return a response.

This function takes your OpenAPI document and an optional set of options and returns a promise object with a 
handler and a router. The handler will use the event that triggered your lambda, your OpenAPI document, and
your options to generate req and res objects to be used by your lambda to respond to API calls. The router will
take those same objects and you will need to pass in a RouteControllerMap object. With those, the router will route
all incoming API calls appropriately and send correctly formatted responses as specified in your OpenAPI document.

The RouteControllerMap object takes a controller and its corresponding operation. For example, if I have a 
controller `persons` and two corresponding operations, `getPersonById` and `findPersonByName`, outlined in my OpenAPI
document, I would pass in the following:

```js
persons: {
  getPersonById: async (req, res) => {
  	const {id} = req.path // get path parameter named "id"
    // ... talk to database
    res.status(200).send(foundPersonObject)
  },
  findPersonByName: async (req, res) => {
  	const {id} = req.path // get path parameter named "id"
    // ... talk to database
    res.status(200).send(foundPersonObject)
  }
}
```

Complete [examples](#examples) with the handler and the router are provided below.

### Handler
`handler (openapi: string | unknown, options: Options = {}, handler: Handler): LambdaHandler`

This function provides the same functionality as the EnforcerLambda function, but it only returns a handler.

### Router
`route (openapi: string | unknown, options: Options = {}, controllers: RouteControllerMap): LambdaHandler`

This function also provides the same functionality as the EnforcerLambda function, but it only returns a handler.

### Options

| Property                  | Description                                                                                       | Type                  | Default        |
|---------------------------|---------------------------------------------------------------------------------------------------|-----------------------|----------------|
| allowOtherQueryParameters | Query parameters not specified in the OpenAPI document are permitted.                             | `boolean \ string[]`  | false          |
| enforcerOptions           | Other options permitted by the [OpenAPI enforcer](https://www.npmjs.com/package/openapi-enforcer) | `Record<string, any>` | null           |
| handleBadRequest          | Bad requests will be handled by the enforcer.                                                     | `boolean`             | true           |
| handleBadResponse         | Bad responses will be handled by the enforcer.                                                    | `boolean`             | true           |
| handleNotFound            | Requests that need to return a status 404 will be handled by the enforcer.                        | `boolean`             | true           |
| handleMethodNotAllowed    | Requests that are not allowed will be handled by the enforcer.                                    | `boolean`             | true           |
| logErrors                 | Log errors to the console.                                                                        | `boolean`             | true           |
| xController               | How controllers are indicated in the provided OpenAPI document.                                   | `string`              | `x-controller` |
| xOperation                | How operations are indicated in the provided OpenAPI document.                                    | `string`              | `x-operation`  |

## Examples

### Simple Handler

Follow the handler pattern if you have only a few endpoints.

Note that the `.handler` function will not call your provided handler unless the request is valid. So your handler will not be called if there are invalid parameters, an invalid method, an invalid url, etc.

```ts
const EnforcerLambda = require('openapi-enforcer-lambda')
const enforcer = EnforcerLambda('./openapi.yml')

exports.handler = enforcer.handler((req, res) => {
    const { operation } = req
    if (operation.operationId === 'getPersonById') {
        const { id } = req.path // get path parameter named "id"
        // ... talk to database
        res.status(200).send(foundPersonObject)
    } else if (operation.operationId === 'findPersonByName') {
        const { name } = req.query // get query parameter named "name"
        // ... talk to database
        res.status(200).send(foundPersonsArray)
    }
})
```

### Simple Router

Follow this router pattern if you have lots of endpoints.

Note that the `.route` function will not call your provided handler unless the request is valid. So your handler will not be called if there are invalid parameters, an invalid method, an invalid url, etc.

index.js

```js
const EnforcerLambda = require('openapi-enforcer-lambda')
const persons = require('./routes/persons')
const dbConnection = require('./db')

const anotherDependency = {}
const enforcer = EnforcerLambda('./openapi.yml')

exports.handler = enforcer.route({
    // property "persons" will be used when the OpenAPI document has an
    // "x-controller" in a path is set to "persons"
    persons: persons(dbConnection, anotherDependency)
})
```

routes/persons.js

```js
module.exports = async function (dbConn, anotherDependency) {
  return { 
    async getPersonById (req, res) {
      const { id } = req.path // get path parameter named "id"
      // ... talk to database
      res.status(200).send(foundPersonObject)
    },
    async findPersonByName (req, res) {
      const { id } = req.path // get path parameter named "id"
      // ... talk to database
      res.status(200).send(foundPersonObject)
    }
  }
}
```

### Example with More Control

In this example we

1. Manually create the Enforcer promise object and push that into the handler.
2. We call the handler only when it is not a GET /health request.

```js
const Enforcer = require('openapi-enforcer')
const EnforcerLambda = require('openapi-enforcer-lambda')

const openapiPromise = Enforcer('./openapi.yml')
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
const enforcer = EnforcerLambda('./openapi.yml')

exports.handler = function (event) {
  if (event.httpMethod === 'GET' && event.path === '/health') {
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/plain'
      },
      body: 'OK'
    }
  } else {
    const handler = enforcer.handler(event)
    handler(openapiPromise, (req, res) => {
      const { operation } = req
      if (operation.operationId === 'getPersonById') {
        const { id } = req.path // get path parameter named "id"
        // ... talk to database
        res.status(200).send(foundPersonObject)
      } else if (operation.operationId === 'findPersonByName') {
        const { name } = req.query // get query parameter named "name"
        // ... talk to database
        res.status(200).send(foundPersonsArray)
      }
    })
  }
}
```

### Testing a Handler Once

If you've created a lambda handler function then you can test it using the `test` function.

```js
const EnforcerLambda = require('openapi-enforcer-lambda')
const enforcer = EnforcerLambda('./openapi.yml')

exports.handler = enforcer.handler((req, res) => {
    // your code here
})

const result = await EnforcerLambda.test(exports.handler, {
  method: 'GET',
  path: '/',
  headers: {},
  body: null
})
```

### Testing a Handler More Than Once

If you've created a lambda handler function then you can test it using the `test` function.

```js
const EnforcerLambda = require('openapi-enforcer-lambda')
const enforcer = EnforcerLambda('./openapi.yml')

exports.handler = enforcer.handler((req, res) => {
    // your code here
})

const test = EnforcerLambda.testSuite(exports.handler)

const result1 = await test({
  method: 'GET',
  path: '/',
  headers: {},
  body: null
})

const result2 = await test({
  method: 'GET',
  path: '/foo'
})
```

### Simple HTTP Dev Server

This pattern is for development purposes only. Using this in production is not recommended.

This will start a server that you can connect to via HTTP and it will convert incoming HTTP requests into AWS Lambda events.
The event will then be sent to the lambda handler. The response that is produced will be translated back into an HTTP
response and sent back to the client.

This is ideal when you want to use Postman to test your Lambda, or if you need to use ngrok or a similar service to help
with the development of your lambda.

**index.js**

Define your lambda handler.

```js
const EnforcerLambda = require('openapi-enforcer-lambda')
const enforcer = EnforcerLambda('./openapi.yml')

exports.handler = enforcer.handler((req, res) => {
    // your request processing code here
})
```

**server.js**

Run this `server.js` file to start a server proxy that calls your lambda.

```js
const { Server } = require('openapi-enforcer-lambda')
const { handler } = require('./index')

const server = new Server(3000, handler)
server.start()
  .then(() => {
    console.log('Server listening on port: ' + server.port)
  })
  .catch(console.error)
```

