const process = require('node:process')
const path = require('node:path')
const sqlite = require('node:sqlite')
const config = require('./config')
const Strings = require('./Strings')

const str = new Strings('main/Database')

const defaultDatabase = path.resolve(config.project.path || require.main.path, 'db', 'db.sqlite')

class DatabaseTransaction {
	_db
	_timeout

	constructor (db, timeout) {
		if (!(db instanceof Database))
			throw str.error('invalid-transaction-database', null, { db: db })

		if (isNaN(timeout) || parseInt(timeout) <= 0)
			throw str.error('invalid-transaction-timeout', null, { timeout: timeout })

		this._db = new Database(db._filename, db._opts)

		if (!this._db.isOpen)
			this._db.open()

		this._timeout = setTimeout(function () {
			this.rollback()
			throw str.error('transaction-timeout')
		}.bind(this), timeout)

		this._db.exec('BEGIN TRANSACTION')
	}

	commit () {
		try {
			clearTimeout(this._timeout)

			let ret = this._db.exec('COMMIT')

			this._db.close()

			return ret
		}
		catch (e) {
			throw str.error('commit-failed', null, { error: e })
		}
	}

	rollback () {
		try {
			clearTimeout(this._timeout)

			let ret = this._db.exec('ROLLBACK')

			this._db.close()

			return ret
		}
		catch (e) {
			throw str.error('rollback-failed', null, { error: e })
		}
	}

	run (...args) {
		return this._db.run(...args)
	}

	get (...args) {
		return this._db.get(...args)
	}

	all (...args) {
		return this._db.all(...args)
	}
}

class Database extends sqlite.DatabaseSync {
	_filename
	_opts

	constructor (filename = defaultDatabase, opts = {}) {
		try {
			super(filename, opts)

			this._filename = filename
			this._opts = JSON.parse(JSON.stringify(opts))
		}
		catch (e) {
			if (this.isOpen)
				this.close()

			throw str.error('load-failed', null, { filename: filename })
		}

		if (this.isOpen)
			this.setup()
	}

	open () {
		this.setup()

		try {
			return super.open()
		}
		catch (e) {
			throw str.error('open-failed', null, { error: e })
		}
	}

	close () {
		try {
			return super.close()
		}
		catch (e) {
			throw str.error('close-failed', null, { error: e })
		}
	}

	setup () {
		try {
			this.exec('PRAGMA foreign_keys=ON')
		}
		catch (e) {
			throw str.error('foreign-key-mode-failed', null, { error: e })
		}
	}

	begin (timeout = 500) {
		try {
			return new DatabaseTransaction(this, timeout)
		}
		catch (e) {
			throw str.error('begin-transaction-failed', null, { error: e })
		}
	}

	run (sql, ...args) {
		try {
			let ret = super.prepare(sql).run(...args)

			return { id: ret.lastInsertRowid, changes: ret.changes }
		}
		catch (e) {
			throw str.error('run-failed', null, { error: err, sql: sql, args: args })
		}
	}

	get (sql, ...args) {
		try {
			return super.prepare(sql).get(...args)
		}
		catch (e) {
			throw str.error('get-failed', null, { error: err, sql: sql, args: args })
		}
	}

	all (sql, ...args) {
		try {
			return super.prepare(sql).all(...args)
		}
		catch (e) {
			throw str.error('get-all-failed', null, { error: err, sql: sql, args: args })
		}
	}
}

module.exports = Database
