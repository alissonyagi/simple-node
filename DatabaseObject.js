const EventEmitter = require('node:events')
const Database = require('./Database')
const Strings = require('./Strings')
const JSONSchema = require('./JSONSchema')

const str = new Strings('DatabaseObject')
const jsonSchema = new JSONSchema(__dirname + '/json-schema')

const schemas = {
	filter: jsonSchema.load('DatabaseObject.filter')
}

module.exports = class DatabaseObject extends EventEmitter {
	_db
	_name
	_schemas

	constructor (name, schemas = {}) {
		if (/[\'\"]/.test(name))
			throw str.error('invalid-table-name', null, { name: name })

		if (typeof schemas !== 'object')
			throw str.error('invalid-schema-list', null)

		super()

		this._name = name
		this._schemas = {}

		for (let p in schemas) {
			if (typeof schemas[p] !== 'function')
				throw str.error('invalid-schema-validator', p, { schema: schemas[p] })

			this._schemas[p] = schemas[p]
		}
	}

	use (db) {
		if (typeof db !== 'object' || (!(db instanceof Database) && db.constructor.name !== 'DatabaseTransaction' && !(db instanceof DatabaseObject))
			throw str.error('invalid-database', null, { db })

		if (db instanceof Databaseobject)
			db = db._db

		return new Proxy(this, {
			get: (target, prop) => (prop === '_db' ? db : target[prop])
		})
	}

	_validate (name, data) {
		if (this._schemas?.[name] && !this._schemas[name](data))
			throw str.error('validation-failed', null, { error: this._schemas[name].errors })
	}

	_params (values, varName = 'c') {
		let params = {}
		let keys = Object.keys(values)
		let cols = keys.map(v => '"' + v + '"')
		let vals = keys.map((v, k) => {
			let col = '$' + varName + k
			params[col] = typeof values[v] === 'object' ? JSON.stringify(values[v]) : values[v]
			return col
		})

		return { params, keys, cols, vals }
	}

	_run (sql, params) {
		str.trace('sql', null, { sql, params })

		return this._db.all(sql, params)
	}

	_filter (filter = {}) {
		if (filter instanceof Array)
			filter = { dummy: filter }

		if (!schemas.filter(filter))
			throw str.error('invalid-filter', null, { error: schemas.filter.errors })

		let params = {}
		let query = this._parseFilter(filter, null, params)

		return { query, params }
	}

	_parseFilter (cur, name = null, list = {}) {
		let col = name?.indexOf('(') === -1 ? JSON.stringify(name) : name

		if (typeof cur !== 'object' || cur === null)
			cur = ['=', cur]

		if (!(cur instanceof Array)) {
			let ret = []
			for (let c in cur)
				ret.push(this._parseFilter(cur[c], c, list))

			if (ret.length === 0)
				return '1 = 1'

			return ret.length === 1 ? ret[0] : '(' + ret.join(' AND ') + ')'
		}

		if (typeof cur[0] === 'object') {
			let ret = []
			for (let i = 0; i < cur.length; i++)
				ret.push(this._parseFilter(cur[i], null, list))
			return '(' + ret.join(' OR ') + ')'
		}

		let parts = cur[0].split(':')
		let params = cur.filter((v, k) => k > 0)

		switch (parts[1]) {
			case 'unescaped':
				break
			case 'escaped':
			default:
				params = params.map(v => {
					if (v === null)
						return v

					let idx = Object.keys(list).length
					let paramName = '$__filter' + idx

					list[paramName] = v

					return paramName
				})
				break
		}

		switch (parts[0]) {
			case 'between':
				return col + ' BETWEEN ' + params[0] + ' AND ' + params[1]
				break
			case 'in':
				return col + ' IN (' + params.join(', ') + ')'
			case '<':
				return col + ' < ' + params[0]
			case '>':
				return col + ' > ' + params[0]
			case '<=':
				return col + ' <= ' + params[0]
			case '>=':
				return col + ' >= ' + params[0]
			case '<>':
				return col + (params[0] === null ? ' IS NOT ' : ' <> ') + params[0]
			case '=':
				return col + (params[0] === null ? ' IS ' : ' = ') + params[0]
			default:
				return '1 = 1'
		}
	}

	insert (values = {}) {
		if (!this._db)
			throw str.error('database-not-connected')

		this._validate('insert', { values })

		this.emit('before-insert', values)

		let parsed = this._params(values)

		let cols = parsed.cols.join(',')
		let vals = parsed.vals.join(',')

		let ret = this._run(`INSERT INTO "${this._name}" (${cols}) VALUES (${vals}) RETURNING *`, parsed.params)

		this.emit('after-insert', ret)

		return ret
	}

	update (values = {}, filter = {}) {
		if (!this._db)
			throw str.error('database-not-connected')

		this._validate('update', { values, filter })

		this.emit('before-update', values, filter)

		let parsed = this._params(values)
		let parsedFilter = this._filter(filter)

		let updatePair = parsed.cols.map((v, k) => v + '=' + parsed.vals[k]).join(',')

		let ret = this._run(`UPDATE "${this._name}" SET ${updatePair} WHERE ${parsedFilter.query} RETURNING *`, { ...parsed.params, ...parsedFilter.params })

		this.emit('after-update', ret)

		return ret
	}

	delete (filter = {}) {
		if (!this._db)
			throw str.error('database-not-connected')

		this._validate('delete', { filter })

		this.emit('before-delete', filter)

		let parsedFilter = this._filter(filter)

		let ret = this._run(`DELETE FROM "${this._name}" WHERE ${parsedFilter.query} RETURNING *`, parsedFilter.params)

		this.emit('after-delete', ret)

		return ret
	}

	select (filter = {}, order = {}, limit = {}) {
		if (!this._db)
			throw str.error('database-not-connected')

		this._validate('select', { filter })

		this.emit('before-select', filter)

		let parsedFilter = this._filter(filter)

		let additional = []

		if (typeof order === 'object') {
			let keys = Object.keys(order)

			if (keys.length > 0)
				additional.push('ORDER BY ' + keys.map(v => '"' + v + '" ' + order[v]).join(','))
		}

		if (typeof limit === 'object') {
			if (typeof limit.count === 'undefined')
				limit.count = 100

			if (typeof limit.offset === 'undefined')
				limit.offset = 0

			if (limit.page)
				limit.offset = limit.count * (limit.page - 1)

			additional.push(`LIMIT ${limit.count} OFFSET ${limit.offset}`)
		}

		let additionalQuery = additional.length > 0 ? ' ' + additional.join(' ') : ''

		let ret = this._run(`SELECT * FROM "${this._name}" WHERE ${parsedFilter.query}${additionalQuery}`, parsedFilter.params)

		this.emit('after-select', ret)

		return ret
	}
}
