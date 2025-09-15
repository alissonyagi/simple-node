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

	load (filename) {
		try {
			let filepath = path.resolve(this.basePath, filename + '.json')

			let schema = require(filepath)
			let compiled = ajv.compile(schema)

			compiled.filename = filename

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
						return new Message(null, target.filename + '/' + v.schemaPath, null, { ...params, ...target.placeholders }, v)
					})

					return target.messages
				}
			})
		}
		catch (e) {
			throw str.error('invalid-json-schema', null, { error: e })
		}
	}
}
