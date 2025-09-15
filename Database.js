const process = require('node:process')
const path = require('node:path')
const sqlite3 = require('sqlite3')
const config = require('./config')
const Strings = require('./Strings')

const str = new Strings('main/Database')

const defaultDatabase = path.resolve(config.project.path || require.main.path, 'db', 'db.sqlite')

class Statement extends sqlite3.Statement {
	constructor (db, sql, callback) {
		super(db, sql, callback)
	}

	close () {
		let trace = str.get('close-failed')

		return new Promise((resolve, reject) => {
			super.finalize(function (err) {
				if (err)
					return reject(str.error(trace, null, { error: err }))

				resolve(true)
			})
		})
	}

	run (...args) {
		let trace = str.get('run-failed')

		return new Promise((resolve, reject) => {
			super.run(...args, function (err) {
				if (err)
					return reject(str.error(trace, null, { error: err, args: args }))

				resolve({ id: this.lastID, changes: this.changes })
			})
		})
	}

	get (...args) {
		let trace = str.get('get-failed')

		return new Promise((resolve, reject) => {
			super.get(...args, function (err, row) {
				if (err)
					return reject(str.error(trace, null, { error: err, args: args }))

				resolve(row)
			})
		})
	}

	all (...args) {
		let trace = str.get('get-all-failed')

		return new Promise((resolve, reject) => {
			super.all(...args, function (err, rows) {
				if (err)
					return reject(str.error(trace, null, { error: err, args: args }))

				resolve(rows)
			})
		})
	}
}

module.exports = class Database extends sqlite3.Database {
	constructor (filename = defaultDatabase) {
		try {
			super(filename)
		}
		catch (e) {
			throw str.error('load-failed', null, { filename: filename })
		}

		try {
			this.run('PRAGMA journal_mode=WAL')
		}
		catch (e) {
			throw str.error('journal-mode-failed', null, { error: e })
		}

		try {
			this.run('PRAGMA foreign_keys=ON')
		}
		catch (e) {
			throw str.error('foreign-key-mode-failed', null, { error: e })
		}
	}

	begin () {
		try {
			return this.run('BEGIN TRANSACTION')
		}
		catch (e) {
			throw str.error('begin-transaction-failed', null, { error: e })
		}
	}

	commit () {
		try {
			return this.run('COMMIT')
		}
		catch (e) {
			throw str.error('commit-failed', null, { error: e })
		}
	}

	rollback () {
		try {
			return this.run('ROLLBACK')
		}
		catch (e) {
			throw str.error('rollback-failed', null, { error: e })
		}
	}

	close () {
		let trace = str.get('close-failed')

		return new Promise((resolve, reject) => {
			super.close(function (err) {
				if (err)
					return reject(str.error(trace, null, { error: err }))

				resolve(true)
			})
		})
	}

	run (...args) {
		let trace = str.get('run-failed')

		return new Promise((resolve, reject) => {
			super.run(...args, function (err) {
				if (err)
					return reject(str.error(trace, null, { error: err, args: args }))

				resolve({ id: this.lastID, changes: this.changes })
			})
		})
	}

	get (...args) {
		let trace = str.get('get-failed')

		return new Promise((resolve, reject) => {
			super.get(...args, function (err, row) {
				if (err)
					return reject(str.error(trace, null, { error: err, args: args }))

				resolve(row)
			})
		})
	}

	all (...args) {
		let trace = str.get('get-all-failed')

		return new Promise((resolve, reject) => {
			super.all(...args, function (err, rows) {
				if (err)
					return reject(str.error(trace, null, { error: err, args: args }))

				resolve(rows)
			})
		})
	}

	prepare (...args) {
		let trace = str.get('prepare-failed')

		return new Promise((resolve, reject) => {
			let stmt = new Statement(this, ...args, function (err) {
				if (err)
					return reject(str.error(trace, null, { error: err, args: args }))

				resolve(stmt)
			})
		})
	}
}
