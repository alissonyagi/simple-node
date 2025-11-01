const process = require('node:process')
const path = require('node:path')
const sqlite = require('node:sqlite')
const config = require('./config')
const Strings = require('./Strings')

const str = new Strings('main/Database')

const defaultDatabase = path.resolve(config.project.path || require.main.path, 'db', 'db.sqlite')

module.exports = class Database extends sqlite.DatabaseSync {
	constructor (filename = defaultDatabase, opts = {}) {
		try {
			super(filename, opts)
		}
		catch (e) {
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

	begin () {
		try {
			return this.exec('BEGIN TRANSACTION')
		}
		catch (e) {
			throw str.error('begin-transaction-failed', null, { error: e })
		}
	}

	commit () {
		try {
			return this.exec('COMMIT')
		}
		catch (e) {
			throw str.error('commit-failed', null, { error: e })
		}
	}

	rollback () {
		try {
			return this.exec('ROLLBACK')
		}
		catch (e) {
			throw str.error('rollback-failed', null, { error: e })
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
