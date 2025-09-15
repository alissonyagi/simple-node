const util = require('node:util')
const EventEmitter = require('node:events').EventEmitter
const Message = require('./Message')
const Date = require('./Date')

const dateRegExp = new RegExp('\{date:([^}]+)\}', 'g')

const defaultOpts = {
	level: 0,
	verbose: false,
	format: "{level}\t{date:iso}\t{message}"
}

/*
Format options:
	- level = debug, info, etc
	- date:<format> (formats in Util.js)
	- message
*/

const voidStream = {
	start: () => {},
	write: () => {},
	end: () => {}
}

const errorStream = {
	start: () => {},
	end: () => {},
	write: (...args) => {
		console.error(...args)
	}
}

const logStream = {
	start: () => {},
	end: () => {},
	write: (...args) => {
		console.log(...args)
	}
}

module.exports = class Logger extends EventEmitter {
	static levels = {
		fatal: {
			bit: 1,
			handler: errorStream,
			trace: true,
			signal: 'SIGINT'
		},
		error: {
			bit: 2,
			handler: errorStream,
			trace: false
		},
		warn: {
			bit: 4,
			handler: errorStream,
			trace: false
		},
		info: {
			bit: 8,
			handler: logStream,
			trace: false
		},
		debug: {
			bit: 16,
			handler: logStream,
			trace: false
		},
		trace: {
			bit: 32,
			handler: logStream,
			trace: true
		}
	}

	static FATAL = this.levels.fatal.bit
	static ERROR = this.levels.error.bit
	static WARN = this.levels.warn.bit
	static INFO = this.levels.info.bit
	static DEBUG = this.levels.debug.bit
	static TRACE = this.levels.trace.bit

	static NONE = 0
	static ALL = Logger.FATAL | Logger.ERROR | Logger.WARN | Logger.INFO | Logger.DEBUG | Logger.TRACE

	static setDefault (opts = {}) {
		for (let p in opts)
			defaultOpts[p] = opts[p]
	}

	level

	handler (obj, event, data, opts = { depth: null }) {
		let chosen = Logger.levels[event]

		if ((chosen.bit & (this.level || defaultOpts.level)) == 0)
			return

		let stream = chosen.handler || voidStream
		let message = data instanceof Error ? data.toString('log') : util.inspect(data, opts)
		let formatted = defaultOpts.format.replace(dateRegExp, (match, fmt) => new Date(data?.date || Date.now()).format(fmt))

		let placeholders = {
			'level': event,
			'message': message
		}

		stream.start()
		stream.write(new Message(null, null, formatted, placeholders, null).toString())

		if (data.extra)
			stream.write(util.inspect(data.extra, opts))

		if (!defaultOpts.verbose && !chosen.trace || !data.stack)
			return

		let stack = data.stack.split("\n")
		stack.shift()
		stack.shift()

		stream.write(stack.join("\n"))
		stream.end()

		if (chosen.signal)
			process.kill(process.pid, chosen.signal)
	}

	constructor (level) {
		super()
		this.level = level

		for (let l in Logger.levels) {
			this.on(l, function (data, opts) {
				this.handler(this, l, data, opts)
			})

			this[l] = function (data, opts) {
				this.emit(l, data, opts)
			}
		}
	}
}
