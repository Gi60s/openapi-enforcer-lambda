
## Installation

This library has a peer dependency on the `openapi-enforcer` package.

```shell
npm install openapi-enforcer-lambda openapi-enforcer
```

## Examples

**Simple Handler**

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

**Simple Router**

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

**Example with More Control**

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
