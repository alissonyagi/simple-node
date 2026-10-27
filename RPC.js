const fs = require('node:fs')
const net = require('node:net')

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
	},
	error: function (err) {
		if (err instanceof Error)
			return { message: err.message, stack: err.stack }

		return err
	}
}

function readMessage (socket, cb) {
	let buf = Buffer.alloc(0)

	socket.on('close', () => {
		buf = Buffer.alloc(0)
	})

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

function writeMessage (socket, input) {
	if (!socket.writable)
		return

	const len = Buffer.alloc(4)
	len.writeUInt32BE(input.length, 0)

	socket.cork()
	socket.write(len)
	socket.write(input)
	socket.uncork()
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

		this.autoclear = opts.autoclear ?? true
		this.expose = opts.expose || false
		this.methods = methods
		this.handshakeHandler = handshakeHandler
	}

	listen (...args) {
		const self = this

		return new Promise((resolve, reject) => {
			const server = net.createServer(socket => {
				socket.on('error', err => {
					server.emit('socketError', err, socket.handshake)
				})

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

						ret.then(val => writeMessage(socket, protocol.response(req.id, true, val))).catch(err => {
							writeMessage(socket, protocol.response(req.id, false, self.expose ? protocol.error(err) : null))
							server.emit('error', err)
						})
					}
					catch (e) {
						if (typeof req === 'object')
							writeMessage(socket, protocol.response(req.id, false, self.expose ? protocol.error(e) : null))
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
		if (typeof opts !== 'object')
			opts = {}

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
			for (let key in self.timer) {
				clearTimeout(self.timer[key])

				delete self.timer[key]

				if (key.startsWith('request-'))
					self.emit(key.replace(/^(request-)/, 'error-'), new Error('socket-closed'))
			}

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
				self.emit('error', e)
			}
		})

		this.on('connect', () => {
			clearTimeout(self.timer.reconnect)

			self.request('__methods', [self.handshake]).then(list => {
				for (let n in self.remote)
					delete self.remote[n]

				if (typeof list !== 'object' || !(list instanceof Array))
					throw new Error('invalid-method-list')

				for (let i = 0; i < list.length; i++)
					self.remote[list[i]] = (...args) => self.request(list[i], args)

				self.emit('ready', true)

				if (self.opts.ping > 0)
					self.ping()
			}).catch(e => {
				self.emit('error', e)
				self.destroy()
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

		// Forces Socket._undestroy to properly reset state

		this.readable = true
		this.writable = true

		super.connect(...args)
	}

	close (force = false) {
		this.opts.reconnect = false

		clearTimeout(this.timer.reconnect)

		delete this.timer.reconnect

		if (force === true)
			this.destroy()
		else
			this.end()
	}

	request (name, args = []) {
		const id = ++this.counter % 1_000_000
		const self = this

		return new Promise((resolve, reject) => {
			if (!this.writable)
				return reject('not-writable')

			writeMessage(self, protocol.request(id, name, args))

			const cleanup = () => {
				self.removeAllListeners('response-' + id)
				self.removeAllListeners('error-' + id)
				self.removeAllListeners('timeout-' + id)

				clearTimeout(self.timer['request-' + id])

				delete self.timer['request-' + id]
			}

			self.once('response-' + id, res => {
				cleanup()
				resolve(res)
			})

			self.once('error-' + id, err => {
				cleanup()
				reject(err)
			})

			self.once('timeout-' + id, () => {
				cleanup()
				reject('timeout')
			})

			self.timer['request-' + id] = setTimeout(() => self.emit('timeout-' + id), self.opts.timeout)
		})
	}

	ping () {
		clearTimeout(this.timer.ping)

		this.request('__ping').then(() => {
			this.emit('ping')

			this.timer.ping = setTimeout(this.ping.bind(this), this.opts.ping)
		}).catch(err => {
			this.emit('pingFailed', err)

			if (this.opts.reconnect && !this.destroyed)
				this.destroy()
		})
	}
}

function listen (socket, methods, opts, handshakeHandler) {
	return new Promise((resolve, reject) => {
		try {
			const server = new Server(methods, opts, handshakeHandler)

			server.listen(socket).then(resolve).catch(reject)
		}
		catch (e) {
			reject(e)
		}
	})
}

function connect (socket, opts = { reconnect: true }) {
	return new Promise((resolve, reject) => {
		try {
			const client = new Client(opts)

			let ready
			let error = err => {
				client.off('ready', ready)
				reject(err)
			}

			ready = () => {
				client.off('error', error)
				resolve(client)
			}

			client.once('ready', ready)
			client.once('error', error)

			client.connect(socket)
		}
		catch (e) {
			reject(e)
		}
	})
}

module.exports = { Server, Client, listen, connect }
