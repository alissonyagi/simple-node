const TelegramBot = require('node-telegram-bot-api')
const Strings = require('./Strings')
const Util = require('./Util')

const str = new Strings('main/Telegram')

const sendFunctions = [
	'sendMessage',
	'sendPhoto',
	'sendAudio',
	'sendDocument',
	'sendVideo',
	'sendAnimation',
	'sendVoice',
	'sendVideoNote',
	'sendMediaGroup',
	'sendLocation',
	'sendVenue',
	'sendContact',
	'sendPoll',
	'sendDice',
	'sendChatAction',
	'sendSticker',
	'sendInvoice',
	'sendGame'
]

module.exports = class Telegram {
	client

	constructor (id, opts = {}, autoInit = true) {
		if (typeof id !== 'string' || id.length === 0)
			throw str.error('invalid-client-id')

		const base = {
			polling: true
		}

		this.client = new TelegramBot(id, Util.merge(base, opts))

		this.client._emit = this.client.emit
		this.client.emit = function (evt, ...args) {
			str.debug('event-' + evt, null, { client: id, args: args })
			this._emit(evt, ...args)
		}

		return new Proxy(this, {
			get (obj, prop) {
				return obj[prop] || obj.client[prop]
			}
		})
	}
}

sendFunctions.forEach(v => {
	module.exports.prototype[v] = async function (chatId, ...args) {
		if (!(chatId instanceof Array))
			return await this.client[v](chatId, ...args)

		let messages = []

		for (let i = 0; i < chatId.length; i++)
			messages[i] = await this.client[v](chatId[i], ...args)

		return messages
	}
})
