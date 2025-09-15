const express = require('express')
const Strings = require('./Strings')
const Message = require('./Message')

const str = new Strings('Router')

const methods = ['all', 'use', 'checkout', 'copy', 'delete', 'get', 'head', 'lock', 'merge', 'mkactivity', 'mkcol', 'move', 'm-search', 'notify', 'options', 'patch', 'post', 'purge', 'put', 'report', 'search', 'subscribe', 'trace', 'unlock', 'unsubscribe']

module.exports = class Router extends express.Router {
	static Response = class Response {
		status
		message

		constructor (status, message) {
			this.status = status
			this.message = message
		}
	}

	constructor (strDest, ...args) {
		super(...args)

		this.str = strDest || str

		super.use((req, res, next) => {
			let self = this

			res.error = function (status, message) {
				let errors = message instanceof Array ? message : [ message ]
				let translate = /^[a-z]{2}_[A-Z]{2}$/.test(req.lang) ? self.str.translate(req.lang) : self.str

				res.status(status).json(errors.map(v => v instanceof Message ? translate.get(v).toString() : v))
			}

			next()
		})
	}

	notFound () {
		super.use((req, res, next) => {
			res.status(404).end()
		})

		return this
	}

	error () {
		super.use((err, req, res, next) => {
			if (res.headersSent)
				return next(err)

			if (err instanceof Router.Response)
				return res.error(err.status, err.message)

			this.str.error('uncaught-error', null, { error: err })

			return res.status(500).end()
		})

		return this
	}

	auto () {
		this.notFound()
		this.error()

		return this
	}

	_wrapper (validate) {
		let ret = function (...args) {
			if (!validate(...args))
				throw new Router.Response(400, validate.messages)
		}

		ret.schema = validate.schema

		return ret
	}

	_overload (method, ...args) {
		let opts = args.length > 1 && typeof args[0] === 'object' && args[0].constructor.name === 'Object' ? args.shift() : {}

		let handler = function (req, res, next) {
			if (handler.output) {
				res._end = res.end
				res.end = function (data = '', ...args) {
					let headers = res.getHeaders()
					let contentType = headers['content-type']?.match(/^[^;]+/g)[0] || 'text/html'
					let body

					switch (contentType) {
						case 'application/json':
							body = JSON.parse(data instanceof Buffer ? data.toString() : data)
							break
						case 'text/plain':
							body = data instanceof Buffer ? data.toString() : data
							break
						default:
							body: data
					}

					try {
						let response = {
							headers: headers
						}

						let statusCode = res.statusCode || 200

						response[statusCode] = {}
						response[statusCode][contentType] = body

						handler.output(response)
					}
					catch (e) {
						str.error('invalid-response', { path: req.path }, { error: e })

						return res.status(e.status || 500)._end()
					}

					return this._end(data, ...args)
				}
			}

			if (handler.input) {
				let request = {
					headers: req.headers,
					params: req.params,
					query: req.query,
					body: {}
				}

				request.body[req.headers['content-type']] = req.body

				handler.input(request)
			}

			next()
		}

		if (typeof opts.output === 'function')
			handler.output =  opts.output.name === 'JSONSchemaValidator' ? this._wrapper(opts.output) : opts.output

		if (typeof opts.input === 'function')
			handler.input =  opts.input.name === 'JSONSchemaValidator' ? this._wrapper(opts.input) : opts.input

		args.splice(typeof args[0] === 'string' || typeof args[0] === 'object' && (args[0] instanceof Array || args[0] instanceof RegExp) ? 1 : 0, 0, handler)

		super[method](...args)

		return this
	}
}

for (let m of methods)
	module.exports.prototype[m] = function (...args) {
		this._overload(m, ...args)
	}
