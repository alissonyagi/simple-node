const path = require('node:path')
const ajv2020 = require('ajv/dist/2020')
const config = require('./config')
const Strings = require('./Strings')
const Message = require('./Message')
const Util = require('./Util')

const ajv = new ajv2020({ strictTuples: false, verbose: config.log.verbose, allErrors: false })
const str = new Strings('main/JSONSchema')

const defaultPath = path.resolve(config.project.path || require.main.path, 'json-schema')

module.exports = class JSONSchema {
	basePath

	constructor (basePath = defaultPath) {
		this.module 
		this.basePath = basePath
	}

	parse (name, schema) {
		try {
			let compiled = ajv.compile(schema)

			compiled.name = name

			Object.defineProperty(compiled, 'name', { value: 'JSONSchemaValidator' })

			return new Proxy(compiled, {
				apply: function (target, self, args) {
					target.data = args[0]
					return target.apply(self, args)
				},
				get: function (target, prop, receiver) {
					if (prop !== 'messages' || target.messages)
						return target[prop]

					if (!(target.errors instanceof Array))
						return []

					target.placeholders = Util.flat(target.data, { accepted: ['string', 'number'] })

					target.messages = target.errors.map(v => {
						let params = Util.flat({ __params: v.params })
						return new Message(null, target.name + '/' + v.schemaPath, null, { ...params, ...target.placeholders }, v)
					})

					return target.messages
				}
			})
		}
		catch (e) {
			throw str.error('invalid-json-schema', null, { error: e })
		}
	}

	load (filename) {
		let schema

		try {
			let filepath = path.resolve(this.basePath, filename + '.json')

			schema = require(filepath)
		}
		catch (e) {
			throw str.error('invalid-json-file', null, { error: e })
		}

		return this.parse(filename, schema)
	}
}
