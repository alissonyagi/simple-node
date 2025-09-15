const https = require('node:https')
const StringsLazy = require('./StringsLazy')

const str = new StringsLazy('main/Util')

module.exports = class Util {
	static aux = {
		count: 0
	}

	static init () {
		if (!str)
			str = new Strings(moduleName)
	}

	// Sends data through https, joining the received data and returning it.

	static send (opts, body = '') {
		let ref = { id: Util.aux.count++ }

		if (!opts.headers)
			opts.headers = {}

		let parsedBody = typeof body === 'object' ? JSON.stringify(body) : body

		opts.headers['Content-Length'] = Buffer.byteLength(parsedBody, 'utf-8')

		str.trace('https-request-sent', null, { ref: ref, opts: opts, body: body })

		return new Promise((resolve, reject) => {
			let req = https.request(opts, res => {
				let response = ''

				res.on('close', () => response === '' ? reject(str.get('no-reponse')) : null)
				res.on('data', chunk => response += chunk)
				res.on('end', () => {
					if (response.length === 0)
						response = null

					let parsed
					let contentType = res.headers['content-type'] ? res.headers['content-type'].split(';')[0] : null

					switch (contentType) {
						case 'application/json':
							parsed = JSON.parse(response)
							break
						default:
							parsed = response
					}

					str.trace('https-response-received', null, { ref: ref, statusCode: res.statusCode, headers: res.headers, response: parsed })

					resolve({ statusCode: res.statusCode, response: parsed })
				})
			})

			req.on('error', err => {
				reject({ statusCode: -1, response: err })
			})

			req.on('timeout', () => {
				req.destroy(str.get('request-timeout'))
			})

			req.on('close', () => {
				req.destroy(str.get('request-closed'))
			})

			req.write(parsedBody)
			req.end()
		})
	}

	// Deep merge objects and return a reference to the merged object (modifies destination)

	static merge (obj1, obj2, mergeArrays = true, overwrite = true) {
		if (Array.isArray(obj2)) {
			for (let i = 0; i < obj2.length; i++)
				Util.merge(obj1, obj2[i], mergeArrays, overwrite)

			return obj1
		}

		if (obj1 === null || typeof obj1 === 'undefined')
			obj1 = {}

		if (obj2 === null || typeof obj2 === 'undefined')
			obj2 = {}

		if (!Util.isObject(obj1) || !Util.isObject(obj2))
			throw str.error('unsupported-merge')

		for (let p in obj2) {
			if (!overwrite && obj1[p])
				continue

			if (Util.isObject(obj2[p]))
				obj1[p] = Util.merge(Util.isObject(obj1[p]) ? obj1[p] : {}, obj2[p], mergeArrays, overwrite)
			else
				obj1[p] = mergeArrays && Array.isArray(obj1[p]) && Array.isArray(obj2[p]) ? obj1[p].concat(obj2[p]) : obj2[p]
		}

		return obj1
	}

	// Deep flat objects (dot notation), returning a new object

	static flat (obj, opts = { depth: null, accepted: [] }, depth = 0, ref = {}, parent = '', indexed = []) {
		if (Array.isArray(obj))
			return obj.flat(Infinity).filter(v => opts.accepted.length === 0 || opts.accepted.includes(typeof v))

		for (let p in obj) {
			if (this.isObject(obj[p])) {
				if ((opts.depth || null) === depth || indexed.includes(obj[p]))
					continue

				indexed.push(obj[p])

				this.flat(obj[p], opts, depth + 1, ref, parent + p + '.', indexed)

				continue
			}

			if (Array.isArray(obj[p])) {
				ref[parent + p] = this.flat(obj[p], opts, depth, ref, parent, indexed)
			}

			if (opts.accepted.length !== 0 && !opts.accepted.includes(typeof obj[p]))
				continue

			ref[parent + p] = obj[p]
		}

		return ref
	}

	// Checks if the specified item is an Object

	static isObject = ref => typeof ref === 'object' && ref !== null && !Array.isArray(ref)

	// Sleeps for a desired amount of time (in milliseconds)

	static sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}
