const path = require('node:path')
const Logger = require('./Logger')
const Message = require('./Message')
const Util = require('./Util')

const logger = new Logger()

const moduleName = 'main/Strings'
const fallback = 'en_US'
const preloaded = {}

const defaultOpts = {
	language: fallback,
	path: '..'
}

function preload (lang) {
	if (/^([a-z]{2}_[A-Z]{2})$/.test(lang) === false) {
		logger.error(new Message(moduleName, 'invalid-language', 'Invalid language specified.'))
		return false
	}

	if (preloaded[lang])
		return true

	let reference = 'strings/' + lang + '.json'

	let basePath
	let baseObj
	let base

	try {
		basePath = path.resolve(__dirname, reference)
		baseObj = require(basePath)
		base = JSON.parse(JSON.stringify(baseObj))
	}
	catch (e) {
		logger.debug(new Message(moduleName, 'base-load-failed', 'Failed to load base strings: {path}', { path: basePath }, { error: e }))
		base = {}
	}

	let complementPath
	let complementObj
	let complement

	try {
		complementPath = path.resolve(defaultOpts.path, reference)

		if (complementPath === basePath)
			preloaded[lang] = { ...base }

		complementObj = require(complementPath)
		complement = JSON.parse(JSON.stringify(complementObj))
	}
	catch (e) {
		logger.debug(new Message(moduleName, 'complement-load-failed', 'Failed to load complement strings: {path}', { reference: reference, path: complementPath }, { error: e }))
		complement = {}
	}

	preloaded[lang] = Util.merge({ ...base }, complement)

	return true
}

module.exports = class Strings {
	module
	lang

	static setDefault (opts = {}) {
		for (let p in opts)
			defaultOpts[p] = opts[p]
	}

	static on (...args) {
		logger.on(...args)
	}

	constructor (module, lang = defaultOpts.language) {
		if (!preload(lang))
			lang = fallback

		this.module = module
		this.lang = lang
	}

	translate (lang = defaultOpts.language) {
		if (!preload(lang))
			lang = fallback

		return new Proxy(this, {
			get (target, prop, receiver) {
				return prop === 'lang' ? lang : target[prop]
			}
		})
	}

	get (reference, placeholders = null, extra = null) {
		if (reference instanceof Array)
			return reference.map(m => this.get(m))

		let msg = reference instanceof Message ? reference.update(placeholders, extra) : new Message(this.module, reference, null, placeholders, extra)

		if (!msg.name)
			msg.name = this.module

		msg.message = preloaded[this.lang]?.[msg.name]?.[msg.cause] || preloaded[fallback]?.[msg.name]?.[msg.cause] || msg.toString('no-message')

		return msg
	}

	handler (type, reference, placeholders = {}, extra = null, opts = { depth: null }) {
		let msg = this.get(reference, placeholders, extra)

		if (msg instanceof Array)
			msg.forEach(v => logger[type](v, opts))
		else
			logger[type](msg, opts)

		return msg
	}
}

// Implements all Logger levels inside class Strings

for (let level in Logger.levels)
	module.exports.prototype[level] = function (...args) {
		return this.handler(level, ...args)
	}
