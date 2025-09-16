const fs = require('node:fs')
const net = require('node:net')
const EventEmitter = require('node:events')

const CHUNK_SIZE = 64 * 1024; // 64KB

const protocol = {
	encode: function (val) {
		return Buffer.from(JSON.stringify(val))
	},
	decode: function (buf) {
		return JSON.parse(buf.toString('utf-8'))
	},
	request: function (id, name, args) {
		return this.encode({ id: id, name: name, args: args })
	},
	parseRequest: function (req) {
		let val = this.decode(req)

		if (typeof val.id !== 'number' || typeof val.name !== 'string' || typeof val.args !== 'object' || !(val.args instanceof Array))
			throw new Error('invalid-request')

		return val
	},
	response: function (id, success, data) {
		return this.encode({ id: id, success: success, data: data })
	},
	parseResponse: function (res) {
		let val = this.decode(res)

		if (typeof val.id !== 'number' || typeof val.success !== 'boolean')
			throw new Error('invalid-response')

		return val
	}
}

function readMessage (socket, cb) {
	let buf = Buffer.alloc(0)

	socket.on('data', chunk => {
		buf = Buffer.concat([buf, chunk])

		while (buf.length >= 4) {
			const len = buf.readUInt32BE(0)

			if (buf.length < 4 + len)
				break

			const complete = buf.slice(4, 4 + len)
			buf = buf.slice(4 + len)

			cb(complete)
		}
	})
}

async function writeMessage (socket, input) {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(input.length, 0)

	const buf = Buffer.concat([len, input])

	let offset = 0

	while (offset < buf.length) {
		const end = Math.min(offset + CHUNK_SIZE, buf.length)
		const chunk = buf.slice(offset, end)
		const written = socket.write(chunk)

		offset = end

		if (!written)
			await new Promise(resolve => socket.once('drain', resolve))
	}
}

class Server {
	methods
	autoclear
	expose

	constructor (methods, opts) {
		if (typeof methods !== 'object')
			throw new Error('invalid-methods')

		for (let n in methods)
			if (typeof methods[n] !== 'function')
				throw new Error('invalid-method', { cause: n })

		if (typeof opts !== 'object')
			opts = {}

		this.autoclear = opts.autoclear || true
		this.expose = opts.expose || false
		this.methods = methods
	}

	listen (...args) {
		const self = this

		return new Promise((resolve, reject) => {
			const server = net.createServer(socket => {
				readMessage(socket, data => {
					let req

					try {
						req = protocol.parseRequest(data)

						let ret

						switch (req.name) {
							case '__ping':
								ret = true
								break
							case '__methods':
								ret = Object.keys(self.methods)
								break
							default:
								if (!self.methods[req.name])
									throw 'invalid-method'

								ret = self.methods[req.name](...req.args)
						}

						if (!(ret instanceof Promise))
							return writeMessage(socket, protocol.response(req.id, true, ret))

						ret.then(val => writeMessage(socket, protocol.response(req.id, true, val))).catch(err => { throw err })
					}
					catch (e) {
						if (typeof req === 'object')
							writeMessage(socket, protocol.response(req.id, false, self.expose ? e : null))
					}
				})
			})

			server.on('listening', () => {
				resolve(server)
			})

			server.on('error', err => {
				reject(err)
			})

			if (typeof args[0] !== 'string' || !self.autoclear || !fs.existsSync(args[0]))
				return server.listen(...args)

			try {
				let tempClient = net.createConnection({ path: args[0] }, () => {
					tempClient.end()
					reject('socket-in-use')
				})

				tempClient.on('error', e => {
					if (e.code !== 'ECONNREFUSED')
						return reject('socket-unavailable')

					fs.unlinkSync(args[0])
					server.listen(...args)
				})
			}
			catch (e) {
				reject(e)
			}
		})
	}
}

class Client extends EventEmitter {
	timeout
	ping
	reconnect

	constructor (opts) {
		super()

		if (typeof opts !== 'object')
			opts = {}

		this.timeout = Math.max(opts.timeout || 10_000, 100)
		this.ping = Math.max(opts.ping || 10_000, 5_000)
		this.reconnect = opts.reconnect || false

		this.on('error', () => {}) // prevents throwing
	}

	connect (...args) {
		const self = this

		const control = {
			args: args,
			client: false,
			methods: {}
		}

		control.request = function (name, args = []) {
			const id = Date.now()
			const client = this.client

			return new Promise((resolve, reject) => {
				writeMessage(client, protocol.request(id, name, args))

				client.once('response-' + id, res => {
					client.removeAllListeners('error-' + id)
					client.removeAllListeners('timeout-' + id)
					resolve(res)
				})

				client.once('error-' + id, err => {
					client.removeAllListeners('response-' + id)
					client.removeAllListeners('timeout-' + id)
					reject(err)
				})

				client.once('timeout-' + id, () => {
					client.removeAllListeners('response-' + id)
					client.removeAllListeners('error-' + id)
					reject('timeout')
				})

				setTimeout(() => {
					client.emit('timeout-' + id)
				}, self.timeout)
			})
		}

		control.ping = function () {
			control.request('__ping').then(() => setTimeout(control.ping, self.ping)).catch(err => {
				if (self.reconnect)
					control.open().then(() => {}).catch(() => setTimeout(control.ping, self.ping))
			})
		}

		control.open = function () {
			try {
				this.client.end()
			}
			catch (e) {}

			const client = net.createConnection(...(this.args))

			client._emit = client.emit
			client.emit = function (...args) {
				self.emit(...args)
				this._emit(...args)
			}

			this.client = client

			readMessage(client, data => {
				let res

				try {
					res = protocol.parseResponse(data)

					client.emit((res.success ? 'response' : 'error') + '-' + res.id, res.data)
				}
				catch (e) {
					if (typeof res === 'object')
						client.emit('error-' + res.id, e)
				}
			})

			return new Promise((resolve, reject) => {
				client.on('error', err => {
					reject(err)
				})

				client.on('ready', () => {
					control.request('__methods').then(list => {
						for (let n in control.methods)
							delete control.methods[n]

						if (typeof list !== 'object' || !(list instanceof Array))
							return reject('invalid-method-list-received')

						for (let i = 0; i < list.length; i++)
							control.methods[list[i]] = (...args) => control.request(list[i], args)

						if (self.ping > 0)
							setTimeout(control.ping, self.ping)

						resolve(control.methods)
					}).catch(e => {
						client.end()
						reject(e)
					})
				})
			})
		}

		return control.open()
	}
}

module.exports = { Server, Client }
