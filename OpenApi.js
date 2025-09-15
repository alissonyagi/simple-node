const fs = require('node:fs')
const path = require('node:path')
const Strings = require('./Strings')
const Util = require('./Util')

const str = new Strings('OpenApi')

const VERSION = '3.1.0'

module.exports = class OpenApi {
	str
	routes

	constructor (strDest) {
		this.str = strDest
		this.routes = {}
	}

	_ (label) {
		return this.str?.get(label).toString() || undefined
	}

	addRoute (path, route) {
		if (!this.routes[path])
			this.routes[path] = []

		this.routes[path].push(route)
	}

	generate (complement = {}) {
		let doc = {
			openapi: VERSION,
			info: {
				title: this._('main.title'),
				description: this._('main.description'),
				version: this._('main.version')
			},
			servers: [],
			tags: [],
			paths: {}
		}

		for (let root in this.routes) {
			for (let i = 0; i < this.routes[root].length; i++) {
				let stack = this.routes[root][i].stack

				if (doc.tags.filter(v => v.name === root).length === 0)
					doc.tags.push({
						name: root,
						description: this._('tags.' + root)
					})

				for (let j = 0; j < stack.length; j++) {
					if (!stack[j].route)
						continue

					let handle = stack[j].route.stack[0].handle
					let inputSchema = handle.input?.schema?.properties
					let outputSchema = handle.output?.schema?.properties

					let route = stack[j].route
					let parts = ('/' + root + '/' + route.path).replace('{', '').split('/').filter(v => v.length > 0).map(v => {
						let ret = {
							label: v.replace(/[:}]/g, ''),
							param: v[0] === ':' ? true : false,
							required: v.slice(-1) !== '}' ? true : false
						}
						ret.normalized = ret.param ? '{' + ret.label + '}' : ret.label.replace(/^./, ret.label[0].toUpperCase())

						return ret
					})
					let path = '/' + parts.map(v => !v.param ? v.label : v.normalized).join('/')
					let name = parts.map(v => !v.param ? v.normalized : '').join('')

					if (!doc.paths[path])
						doc.paths[path] = {}

					let methods = []

					for (let m in route.methods) {
						if (!route.methods[m])
							continue

						if (m === '_all') {
							methods['get'] = 'all'
							methods['post'] = 'all'
						}
						else
							methods[m] = m
					}

					for (let m in methods) {
						let prefix = 'route.' + root + '.' + methods[m] + '.'

						if (!doc.paths[path][m])
							doc.paths[path][m] = {
								tags: [root],
								summary: this._(prefix + 'summary'),
								description: this._(prefix + 'description')
							}

						let cur = doc.paths[path][m]

						if (cur.tags.indexOf(root) === -1)
							cur.tags.push(root)

						let params = []

						if (inputSchema?.params?.properties)
							for (let param in inputSchema.params.properties)
								params.push({
									name: param,
									in: 'path',
									description: this._(prefix + 'params.' + param + '.description'),
									required: inputSchema.params.required && inputSchema.params.required.indexOf(param) !== -1 ? true : false,
									schema: inputSchema.params.properties[param]
								})
						else
							params = parts.filter(v => v.param).map(v => {
								return {
									name: v.label,
									in: 'path',
									description: this._(prefix + 'params.' + v.label + '.description'),
									required: v.required
								}
							})

						if (inputSchema?.query?.properties)
							for (let param in inputSchema.query.properties)
								params.push({
									name: param,
									in: 'query',
									description: this._(prefix + 'query.' + v.label + '.description'),
									required: inputSchema.query.required && inputSchema.query.required.indexOf(param) !== -1 ? true : false,
									schema: inputSchema.query.properties[param]
								})

						if (params.length > 0)
							cur.parameters = params

						if (inputSchema?.body?.properties) {
							if (!cur.requestBody)
								cur.requestBody = {
									content: {}
								}

							cur.requestBody.description = this._(prefix + 'body.description')

							for (let mime in inputSchema.body.properties)
								cur.requestBody['content'][mime] = {
									schema: inputSchema.body.properties[mime]
								}
						}

						if (outputSchema) {
							if (!cur.responses)
								cur.responses = {}

							for (let statusCode in outputSchema) {
								if (statusCode === 'headers')
									continue

								cur.responses[statusCode] = {
									description: this._(prefix + 'response.' + statusCode + '.description'),
									content: {}
								}

								if (!outputSchema[statusCode].properties)
									continue

								for (let mime in outputSchema[statusCode].properties)
									cur.responses[statusCode].content[mime] = {
										schema: outputSchema[statusCode].properties[mime]
									}
							}
						}
					}
				}
			}
		}

		return Util.merge(doc, complement)
	}
}
