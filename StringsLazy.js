const Logger = require('./Logger')
const Message = require('./Message')

var Strings

const logger = new Logger()

const timeout = 10 // seconds
const start = Date.now()

var available = false

var checkInterval = setInterval(() => {
	if (Date.now() > start + timeout * 1000)
		return clearInterval(checkInterval)

	try {
		Strings = require('./Strings')

		let temp = new Strings('main/StringsLazy')
		delete temp

		available = true

		clearInterval(checkInterval)
	}
	catch (e) {
	}
}, 100)

module.exports = function (module, lang) {
	var str = {
		module: module,
		lang: lang,
		unavailable: true
	}

	return new Proxy(str, {
		get (target, prop, receiver) {
			if (target.unavailable && available)
				target = new Strings(target.module, target.lang)

			if (prop in target)
				return target[prop]

			return function (...args) {
				let reference = args.shift()
				let msg = new Message(target.module, reference, null, ...args)

				if (['fatal', 'error', 'warn', 'info', 'debug', 'trace'].indexOf(prop) !== -1)
					logger[prop](msg)

				return msg
			}
		}
	})
}
