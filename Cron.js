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
	'@hourly': '0 * * * *'
}

const regexFields = /^(?<minute>[^\t ]+)[\t ](?<hour>[^\t ]+)[\t ](?<dom>[^\t ]+)[\t ](?<month>[^\t ]+)[\t ](?<dow>[^\t ]+)/

module.exports = class Cron {
	crontab

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
	}

	add (interval, what) {
		if (typeof what !== 'function')
			throw str.error('invalid-function')

		this.crontab.push({ interval, what })
	}

	start () {
		this.#run(true)
	}

	async #run (firstRun = false) {
		let now = new Date()
		let nextRun = new Date().add(1, 'minute').truncate('seconds')

		setTimeout(this.#run.bind(this), nextRun - Date.now())

		for (let record of this.crontab) {
			if (record.interval === '@reboot' && !firstRun)
				continue

			let interval = map[record.interval] || record.interval
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
				await record.what()
			}
			catch (e) {
				str.error('failed', null, { error: e })
			}
		}
	}
}
