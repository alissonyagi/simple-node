module.exports = class Message extends Error {
	date

	constructor (module, reference, message, placeholders, extra) {
		super()

		this.date = new Date()
		this.name = module
		this.placeholders = placeholders
		this.extra = extra

		if (reference instanceof Error) {
			this.cause = reference.name
			this.message = message || reference.message
		}
		else {
			this.cause = reference
			this.message = message
		}
	}

	update (placeholders, extra) {
		if (typeof placeholders ===  'object' && !(placeholders instanceof Array))
			this.placeholders = { ...this.placeholders, ...placeholders }

		if (typeof extra ===  'object' && !(extra instanceof Array))
			this.extra = { ...this.extra, ...extra }

		return this
	}

	toString (type) {
		let msg = this.message

		if (msg && this.placeholders && this.placeholders instanceof Object)
			for (let p in this.placeholders) {
				let regexp = new RegExp('\{' + p + '\}', 'g')
				msg = msg.replace(regexp, this.placeholders[p])
			}

		switch (type) {
			case 'log':
				return this.name + ': ' + this.cause + (msg ? "\n" + msg : '')
			case 'no-message':
				return this.cause
				//return JSON.stringify({ reference: this.cause, placeholders: this.placeholders })
			default:
				return msg || this.cause
		}
	}
}
