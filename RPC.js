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

	constructor (methods, opts, handshakeHandler) {
		if (typeof methods !== 'object')
			throw new Error('invalid-methods')

		for (let n in methods)
			if (typeof methods[n] !== 'function')
				throw new Error('invalid-method', { cause: n })

		if (typeof opts !== 'object')
			opts = {}

		if (typeof handshakeHandler !== 'function')
			handshakeHandler = () => true

		this.autoclear = opts.autoclear || true
		this.expose = opts.expose || false
		this.methods = methods
		this.handshakeHandler = handshakeHandler
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
								ret = new Promise(async (resolve, reject) => {
									try {
										let handshakeRet = await self.handshakeHandler(req.args[0])

										if (handshakeRet === false)
											return reject(false)

										socket.handshake = req.args[0]
										resolve(Object.keys(self.methods))
									}
									catch (e) {
										reject(e)
									}
								})
								break
							default:
								if (!self.methods[req.name])
									throw 'invalid-method'

								server.emit('rpc', socket.handshake, req.name, req.args)

								ret = self.methods[req.name](...req.args)
						}

						if (!(ret instanceof Promise))
							return writeMessage(socket, protocol.response(req.id, true, ret))

						ret.then(val => writeMessage(socket, protocol.response(req.id, true, val))).catch(err => server.emit('error', err))
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

class Client extends net.Socket {
	opts
	remote
	args
	timer
	counter

	constructor (opts, handshake = {}) {
		super(opts)

		this.opts = {
			timeout: Math.max(opts.timeout || 10_000, 100),
			ping: Math.max(opts.ping || 10_000, 5_000),
			reconnect: opts.reconnect || false
		}

		this.handshake = handshake
		this.remote = {}
		this.timer = {}
		this.counter = 0

		this.on('error', () => {}) // prevents throwing

		const self = this

		this.on('close', () => {
			try {
				clearTimeout(self.timer.ping)
			}
			catch (e) {}

			if (self.opts.reconnect) {
				self.timer.reconnect = setTimeout(() => {
					self.emit('reconnecting')
					self.connect(...self.args)
				}, self.opts.ping)
			}
		})

		readMessage(this, data => {
			let res

			try {
				res = protocol.parseResponse(data)

				self.emit((res.success ? 'response' : 'error') + '-' + res.id, res.data)
			}
			catch (e) {
				if (typeof res === 'object')
					self.emit('error-' + res.id, e)
			}
		})

		this.on('connect', () => {
			self.request('__methods', [self.handshake]).then(list => {
				for (let n in self.remote)
					delete self.remote[n]

				if (typeof list !== 'object' || !(list instanceof Array))
					return self.emit('error', new Error('invalid-method-list'))

				for (let i = 0; i < list.length; i++)
					self.remote[list[i]] = (...args) => self.request(list[i], args)

				self.emit('ready', true)

				if (self.opts.ping > 0)
					self.ping()
			}).catch(e => {
				self.emit('error', e)
				self.end()
			})
		})
	}

	emit (name, ...args) {
		if (name === 'ready' && args[0] !== true)
			return

		super.emit(name, ...args)

		if (name !== 'any')
			this.emit('any', name, ...args)
	}

	connect (...args) {
		this.args = args
		super.connect(...args)
	}

	close (force = false) {
		this.opts.reconnect = false

		if (force === true)
			this.destroy()
		else
			this.end()
	}

	request (name, args = []) {
		const id = ++this.counter % 1_000_000
		const self = this

		return new Promise((resolve, reject) => {
			writeMessage(self, protocol.request(id, name, args))

			self.once('response-' + id, res => {
				self.removeAllListeners('error-' + id)
				self.removeAllListeners('timeout-' + id)

				clearTimeout(self.timer['request-' + id])

				resolve(res)
			})

			self.once('error-' + id, err => {
				self.removeAllListeners('response-' + id)
				self.removeAllListeners('timeout-' + id)

				clearTimeout(self.timer['request-' + id])

				reject(err)
			})

			self.once('timeout-' + id, () => {
				self.removeAllListeners('response-' + id)
				self.removeAllListeners('error-' + id)
				reject('timeout')
			})

			self.timer['request-' + id] = setTimeout(() => self.emit('timeout-' + id), self.opts.timeout)
		})
	}

	ping () {
		this.request('__ping').then(() => {
			this.emit('ping')

			this.timer.ping = setTimeout(this.ping.bind(this), this.opts.ping)
		}).catch(err => {
			this.emit('pingFailed', err)
		})
	}
}

module.exports = { Server, Client }
