const Database = require('./Database')
const Strings = require('./Strings')
const JSONSchema = require('./JSONSchema')

const str = new Strings('DatabaseObject')
const jsonSchema = new JSONSchema(__dirname + '/json-schema')

const schemas = {
	filter: jsonSchema.load('DatabaseObject.filter')
}

module.exports = class DatabaseObject {
	_db
	_name
	_schemas

	constructor (name, schemas = {}, db) {
		if (/[\'\"]/.test(name))
			throw str.error('invalid-table-name', null, { name: name })

		if (typeof schemas !== 'object')
			throw str.error('invalid-schema-list', null)

		if (!(db instanceof Database) || !(db instanceof DatabaseTransaction))
			throw str.error('invalid-database', null, { db: db })

		this._db = db
		this._name = name
		this._schemas = {}

		for (let p in schemas) {
			if (typeof schemas[p] !== 'function')
				throw str.error('invalid-schema-validator', p, { schema: schemas[p] })

			this._schemas[p] = schemas[p]
		}
	}

	_validate (name, values, varName = 'c') {
		if (this._schemas?.[name] && !this._schemas[name](values))
			throw str.error('validation-failed', null, { error: this._schemas[name].errors })

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

	_filter (name, filter = {}) {
		if (filter instanceof Array)
			filter = { dummy: filter }

		if (!schemas.filter(filter))
			throw str.error('invalid-filter', null, { error: schemas.filter.errors })

		if (this._schemas?.[name] && !this._schemas[name](filter))
			throw str.error('validation-failed', null, { error: this._schemas[name].errors })

		let params = {}
		let query = this._parseFilter(filter, null, params)

		return { query: query, params: params }
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
		let parsed = this._validate('create', values)

		let cols = parsed.cols.join(',')
		let vals = parsed.vals.join(',')

		return this._db.all(`INSERT INTO "${this._name}" (${cols}) VALUES (${vals}) RETURNING *`, parsed.params)
	}

	update (values = {}, filter = {}) {
		let parsed = this._validate('update', values)
		let parsedFilter = this._filter('updatefilter', filter)

		let updatePair = parsed.cols.map((v, k) => v + '=' + parsed.vals[k]).join(',')

		return this._db.all(`UPDATE "${this._name}" SET ${updatePair} WHERE ${parsedFilter.query} RETURNING *`, { ...parsed.params, ...parsedFilter.params })
	}

	delete (filter = {}) {
		let parsedFilter = this._filter('delete', filter)

		return this._db.all(`DELETE FROM "${this._name}" WHERE ${parsedFilter} RETURNING *`)
	}

	select (filter = {}) {
		let parsedFilter = this._filter('select', filter)

		return this._db.all(`SELECT * FROM "${this._name}" WHERE ${parsedFilter.query}`, parsedFilter.params)
	}
}
