const wweb = require('whatsapp-web.js')
const Strings = require('./Strings')
const Util = require('./Util')

const str = new Strings('main/WhatsApp')

module.exports = class WhatsApp {
	static {
		for (let p in wweb)
			this[p] = wweb[p]
	}

	client

	constructor (id, opts = {}, autoInit = true) {
		if (typeof id !== 'string' || id.length === 0)
			throw str.error('invalid-client-id')

		const base = {
			webVersionCache: {
				remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/refs/heads/main/html/2.3000.1026810516-alpha.html',
				type: 'remote'
			},
			authStrategy: new WhatsApp.LocalAuth({ clientId: id }),
			puppeteer: {
				args: ['--no-sandbox', '--disable-setuid-sandbox', '--single-process', '--no-zygote']
			}
		}

		this.client = new WhatsApp.Client(Util.merge(base, opts))

		this.client._emit = this.client.emit
		this.client.emit = function (evt, ...args) {
			str.debug('event-' + evt, null, { client: id, args: args })
			this._emit(evt, ...args)
		}

		if (autoInit)
			this.init()

		this.client.on('ready', () => this.ping())

		return new Proxy(this, {
			get (obj, prop) {
				return obj[prop] || obj.client[prop]
			}
		})
	}

	async ping () {
		try {
			let self = this

			await self.client.sendPresenceAvailable()

			setTimeout(async () => {
				await this.client.sendPresenceUnavailable()
			}, (Math.floor(Math.random() * 100) % 60) * 1000)

			setTimeout(async () => {
				await this.ping.apply(this)
			}, (Math.floor(Math.random() * 100) % 30) * 60 * 1000)
		}
		catch (e) {
			throw str.error('ping-failed', null, { error: e })
		}
	}

	async init () {
		try {
			await this.client.initialize()
		}
		catch (e) {
			throw str.error('init-failed', null, { error: e })
		}
	}

	async sendMessage (chatId, ...args) {
		if (!(chatId instanceof Array))
			return await this.client.sendMessage(chatId, ...args)

		let messages = []

		for (let i = 0; i < chatId.length; i++)
			messages[i] = await this.client.sendMessage(chatId[i], ...args)

		return messages
	}
}
