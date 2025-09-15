const fs = require('node:fs')
const path = require('node:path')
const { exec } = require('node:child_process')
const config = require('./config')
const Strings = require('./Strings')

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

process.on('uncaughtException', err => {
	str.error('uncaught-exception', null, { error: err })
})

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

	constructor (crontab) {
		this.crontab = path.resolve(config.project.path, crontab)

		if (!fs.existsSync(this.crontab))
			throw str.error('crontab-not-found', null, { path: this.crontab })

		this.#run(true)
	}

	async #run (firstRun = false) {
		let now = new Date()
		let nextRun = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 1, 0)

		setTimeout(this.#run.bind(this), nextRun - Date.now())

		let crontab = fs.readFileSync(this.crontab, { encoding: 'utf8' })
		let rows = crontab.split("\n")
		let opts = { env: process.env }

		for (let i = 0; i < rows.length; i++) {
			if (rows[i] === '' || rows[i][0] === '#')
				continue

			if (/^[a-zA-Z0-9_]+=/.test(rows[i])) {
				let parts = rows[i].split('=', 2)

				opts.env[parts[0]] = parts[1]

				if (parts[0] === 'SHELL')
					opts.shell = parts[1]

				continue
			}

			let regexAlias = /^(@[^\t ]+)/
			let alias = rows[i].match(regexAlias)?.[0]

			if (alias === '@reboot' && !firstRun || alias !== '@reboot' && firstRun)
				continue

			if (alias)
				rows[i] = rows[i].replace(regexAlias, map[alias])

			let fields = rows[i].match(/^(?<minute>[^\t ]+)[\t ](?<hour>[^\t ]+)[\t ](?<dom>[^\t ]+)[\t ](?<month>[^\t ]+)[\t ](?<dow>[^\t ]+)[\t ](?<cmd>.+)/)

			if (fields === null)
				continue

			if (!Cron.parse(fields.groups.minute, '0-59', now.getMinutes()) ||
			    !Cron.parse(fields.groups.hour, '0-23', now.getHours()) ||
			    !Cron.parse(fields.groups.dom, '1-31', now.getDate()) ||
			    !Cron.parse(fields.groups.month, '1-12', now.getMonth() + 1) ||
			    !Cron.parse(fields.groups.dow, '0-6', now.getDay()) || (now.getDay() === 0 ? Cron.parse(fields.groups.dow, '0-6', 7) : false))
				continue

			str.debug('running', { cmd: fields.groups.cmd })

			exec(fields.groups.cmd, opts, (err, stdout, stderr) => {
				if (err)
					str.error('command-error', null, { error: err })

				if (stdout) {
					str.info('command-stdout', null, { output: stdout })
					console.log(stdout)
				}

				if (stderr) {
					str.info('command-stderr', null, { output: stderr })
					console.error(stderr)
				}
			})
		}
	}
}
