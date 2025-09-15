const EventEmitter = require('node:events')
const config = require('./config')
const Strings = require('./Strings')

const str = new Strings('main/TimeSlot')

const defaultTimeout = 5
const defaultMaxRunTime = 5

/*

Events:
	- timeout
	- start
	- maxRunTime
	- success
	- error
	- done

*/

class TimeSlotObject extends EventEmitter {
	scope
	func
	id
	timeout
	maxRunTime
	args
	status
	result
	priority

	_stats

	constructor (scope, func, opts, ...args) {
		super()

		this.scope = scope
		this.func = func
		this.id = opts?.id || null
		this.timeout = Date.now() + (opts?.timeout || defaultTimeout) * 1000
		this.maxRunTime = opts?.maxRunTime || defaultMaxRunTime
		this.args = args
		this.status = 'waiting'

		this._stats = {
			created: Date.now(),
			set start (v) {
				delete this.start
				this.start = v
				this.wait = v - this.created
			},
			set end (v) {
				delete this.end 
				this.end = v
				this.elapsed = v - this.start
			}
		}

		this.on('error', err => {}) // Avoids crashing
	}

	run () {
		let self = this

		this.status = 'running'
		this._stats.start = Date.now()

		if (Date.now() > this.timeout) {
			this.status = 'timeout'
			this._stats.end = Date.now()
			this.emit('timeout')
			this.emit('done')

			return Promise.reject()
		}

		this.emit('start')

		let maxRunTimePromise = new Promise((resolve, reject) => {
			self.timer = setTimeout(() => {
				self.emit('maxRunTime')
				reject()
			}, this.maxRunTime * 1000)
		})

		let funcPromise

		try {
			funcPromise = Promise.resolve(this.func.apply(this.scope, this.args))
		}
		catch (e) {
			funcPromise = Promise.reject(e)
		}

		return new Promise((resolve, reject) => {
			Promise.race([maxRunTimePromise, funcPromise]).then(val => {
				self.status = 'success'
				self.result = val
				self.emit('success', val)
			}).catch(err => {
				self.status = 'error'
				self.result = err
				self.emit('error', err)
			}).finally(() => {
				if (self.timer)
					clearTimeout(self.timer)

				self._stats.end = Date.now()
				self.emit('done')
				resolve()
			})
		})
	}

	stats () {
		return {
			created: new Date(this._stats.created),
			start: this._stats.start ? new Date(this._stats.start) : null,
			end: this._stats.end ? new Date(this._stats.end) : null,
			wait: (this._stats.wait / 1000) || null,
			elapsed: (this._stats.elapsed / 1000) || null
		}
	}
}

module.exports = class TimeSlot {
	#scope
	#interval
	#queue
	#timer

	constructor (scope, interval = 1) {
		this.#scope = scope
		this.#interval = interval * 1000
		this.#queue = {
			low: [],
			medium: [],
			high: []
		}
		this.#timer = false
	}

	next (priority) {
		return this.#queue[priority]?.filter(v => v.status === 'waiting')[0]
	}

	run () {
		let self = this
		let next = this.next('high') || this.next('medium') || this.next('low')

		if (!next?.run)
			return this.setTimer()

		self.remove(next)

		next.run().then(() => {
			self.setTimer()
		}).catch(() => {
			self.run()
		})
	}

	setTimer () {
		let self = this

		this.#timer = setTimeout(() => self.run(), this.#interval)
	}

	create (func, opts, ...args) {
		return new TimeSlotObject(this.#scope, func, opts, ...args)
	}

	remove (obj) {
		if (!obj.priority || !this.#queue[obj.priority])
			return

		let idx = this.#queue[obj.priority].indexOf(obj)

		if (idx !== -1)
			this.#queue[obj.priority].splice(idx, 1)
	}

	queue (obj, priority = 'low') {
		if (!this.#queue[priority])
			throw str.error('invalid-priority', { priority: priority })

		if (!(obj instanceof TimeSlotObject))
			throw str.error('invalid-timeslot-object')

		obj.priority = priority

		this.#queue[priority].push(obj)

		if (!this.#timer) {
			this.#timer = true
			this.run()
		}
	}
}
