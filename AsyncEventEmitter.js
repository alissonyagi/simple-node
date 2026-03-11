const { EventEmitter } = require('node:events')

module.exports = class AsyncEventEmitter extends EventEmitter {
	constructor (...args) {
		super(...args)
	}

	async emit (name, ...args) {
		const listeners = this.rawListeners(name)

		if (listeners.length === 0)
			return false

		for (let listener of listeners) {
			try {
				await listener.call(this, ...args)
			}
			catch (e) {
				if (name === 'error' || this.listeners('error').length === 0)
					throw e

				await this.emit('error', e)
				return true
			}
		}

		return true
	}
}
