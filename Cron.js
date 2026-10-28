const Strings = require('./Strings')
const Date = require('./Date')

const str = new Strings('Cron')

const map = {
	'@reboot': '* * * * *',
	'@yearly': '0 0 1 1 *',
	'@anually': '0 0 1 1 *',
	'@monthly': '0 0 1 * *',
	'@weekly': '0 0 * * 0',
	'@daily': '0 0 * * *',
	'@midnight': '0 0 * * *',
	'@hourly': '0 * * * *',
	'@minutely': '* * * * *',
}

const regexFields = /^(?<minute>[^\t ]+)[\t ](?<hour>[^\t ]+)[\t ](?<dom>[^\t ]+)[\t ](?<month>[^\t ]+)[\t ](?<dow>[^\t ]+)/

module.exports = class Cron {
	crontab
	#nextRun

	static parse (val, asterisk, expected) {
		let list = val.replace('*', asterisk).split(',')

		for (let i = 0; i < list.length; i++) {
			let parts = list[i].split('/')
			let range = parts[0].split('-').map(v => parseInt(v))
			let step = parseInt(parts[1]) || 1

			let end = range[1] || range[0]

			for (let j = range[0]; j <= end; j += step)
				if (j === expected)
					return true
		}

		return false
	}

	constructor () {
		this.crontab = []
		this.#nextRun = null
	}

	on (interval, what, ...args) {
		if (typeof what !== 'function')
			throw str.error('invalid-function')

		if (interval?.constructor?.name === 'Date')
			return this.once(interval, what, ...args)

		let record = { interval, what, args }

		this.crontab.push(record)

		return record
	}

	off (record) {
		let pos = this.crontab.indexOf(record)

		if (pos >= 0)
			this.crontab.splice(pos, 1)
	}

	once (interval, what, ...args) {
		let self = this
		let record = { interval, args }

		record.what = async function (...internal) {
			await what(...internal)
			self.off(record)
		}

		this.crontab.push(record)

		return record
	}

	start () {
		this.#run(true)
	}

	async #run (firstRun = false) {
		let now = new Date()

		this.#nextRun = new Date().add(1, 'minute').truncate('seconds').getTime()

		setTimeout(this.#run.bind(this), this.#nextRun - Date.now())

		for (let record of this.crontab) {
			let parsed

			if (record.interval.constructor.name === 'Date') {
				if (record.interval.getTime() > this.#nextRun)
					continue

				parsed = '@minutely'
			}
			else
				parsed = record.interval

			if (parsed === '@reboot' && !firstRun || parsed !== '@reboot' && firstRun)
				continue

			let interval = map[parsed] || parsed
			let fields = interval.match(regexFields)

			if (fields === null)
				continue

			if (!Cron.parse(fields.groups.minute, '0-59', now.getMinutes()) ||
			    !Cron.parse(fields.groups.hour, '0-23', now.getHours()) ||
			    !Cron.parse(fields.groups.dom, '1-31', now.getDate()) ||
			    !Cron.parse(fields.groups.month, '1-12', now.getMonth() + 1) ||
			    !Cron.parse(fields.groups.dow, '0-6', now.getDay()) || (now.getDay() === 0 ? Cron.parse(fields.groups.dow, '0-6', 7) : false))
				continue

			str.debug('running', record.what.name)

			try {
				await record.what(...record.args)
			}
			catch (e) {
				str.error('failed', null, { error: e })
			}
		}
	}
}
