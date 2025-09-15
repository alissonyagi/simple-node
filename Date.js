module.exports = class Date extends global.Date {
	constructor (...args) {
		super(...args)
	}

	static #formats = {
		'iso': 'Y-m-d\\TH:i:s.v\\Z',
		'iso-read': 'Y-m-d H:i:s' // ISO readable
	}

	static #from (utc, match) {
		if (this.#format.escape) {
			this.#format.escape = false
			return match
		}

		if (match === '\\') {
			this.#format.escape = true
			return ''
		}

		if (match === '[' || match === ']')
			match = '\\' + match

		switch (match) {
			case 'H':
				return '(?<hours>[0-9]{2})'
			case 'i':
				return '(?<minutes>[0-9]{2})'
			case 's':
				return '(?<seconds>[0-9]{2})'
			case 'v':
				return '(?<milliseconds>[0-9]{3})'
			case 'd':
				return '(?<date>[0-9]{2})'
			case 'm':
				return '(?<month>[0-9]{2})'
			case 'Y':
				return '(?<fullYear>[0-9]{4})'
			default:
				return '[' + match + ']'
		}
	}

	static from (val, fmt, utc = false) {
		try {
			if (Date.#formats[fmt])
				fmt = Date.#formats[fmt]

			let ref = new Date()

			let regex = new RegExp('^' + fmt.replace(/./ig, Date.#from.bind(ref, utc)) + '$', 'g')
			let parts = regex.exec(val)
			let groups = parts.groups || {}

			let res

			if (utc)
				res = new Date(Date.UTC(
					groups.fullYear || ref.getUTCFullYear(),
					(parseInt(groups.month) - 1) || ref.getUTCMonth(),
					groups.date || ref.getUTCDate(),
					groups.hours || ref.getUTCHours(),
					groups.minutes || ref.getUTCMinutes(),
					groups.seconds || ref.getUTCSeconds(),
					groups.milliseconds || ref.getUTCMilliseconds()
				))
			else
				res = new Date(
					groups.fullYear || ref.getFullYear(),
					(parseInt(groups.month) - 1) || ref.getMonth(),
					groups.date || ref.getDate(),
					groups.hours || ref.getHours(),
					groups.minutes || ref.getMinutes(),
					groups.seconds || ref.getSeconds(),
					groups.milliseconds || ref.getMilliseconds()
				)

			let check = res.format(fmt, utc)

			if (check !== val)
				throw 'Invalid date specified'

			return res
		}
		catch (e) {
			return new Date('')
		}
	}

	#format = {
		escape: false,
		pad: (num, count = 2) => ('0'.repeat(count) + num).substr(-count),
		replacer: function (utc, match) {
			if (this.#format.escape) {
				this.#format.escape = false
				return match
			}

			if (match === '\\') {
				this.#format.escape = true
				return ''
			}

			switch (match) {
				case 'H':
					return this.#format.pad(utc ? this.getUTCHours() : this.getHours())
				case 'i':
					return this.#format.pad(utc ? this.getUTCMinutes() : this.getMinutes())
				case 's':
					return this.#format.pad(utc ? this.getUTCSeconds() : this.getSeconds())
				case 'v':
					return this.#format.pad(utc ? this.getUTCMilliseconds() : this.getMilliseconds(), 3)
				case 'd':
					return this.#format.pad(utc ? this.getUTCDate() : this.getDate())
				case 'm':
					return this.#format.pad(utc ? this.getUTCMonth() + 1 : this.getMonth() + 1)
				case 'Y':
					return utc ? this.getUTCFullYear() : this.getFullYear()
				default:
					return match
			}
		}
	}

	format (fmt, utc = false) {
		if (Date.#formats[fmt])
			fmt = Date.#formats[fmt]

		this.#format.escape = false

		return fmt.replace(/./ig, this.#format.replacer.bind(this, utc))
	}

	add (num, unit = 'second') {
		switch (unit) {
			case 'ms':
			case 'millisecond':
			case 'milliseconds':
				this.setTime(this.getTime() + num)
				break
			case 's':
			case 'sec':
			case 'second':
			case 'seconds':
				this.setSeconds(this.getSeconds() + num)
				break
			case 'm':
			case 'min':
			case 'minute':
			case 'minutes':
				this.setMinutes(this.getMinutes() + num)
				break
			case 'h':
			case 'hour':
			case 'hours':
				this.setHours(this.getHours() + num)
				break
			case 'd':
			case 'day':
			case 'days':
				this.setDate(this.getDate() + num)
				break
			case 'w':
			case 'week':
			case 'weeks':
				this.setDate(this.getDate() + num * 7)
				break
			case 'mon':
			case 'month':
			case 'months':
				this.setMonth(this.getMonth() + num)
				return this
				break
			case 'y':
			case 'year':
			case 'years':
				this.setFullYear(this.getFullYear() + num)
				return this
				break
			default:
				throw 'Invalid unit specified'
		}

		return this
	}

	getTimestamp () {
		return Math.round(this.getTime() / 1000)
	}
}
