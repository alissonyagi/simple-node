window.Database = function () {
	var main = function (type, name, opts) {
		if (name && !main.config.regexp.test(name))
			main.error('invalid-database-name', name)

		if (!type)
			main.error('type-not-specified')

		if (!name)
			name = main.config.defaultNames.db

		switch (type) {
			case 'local':
			case 'session':
				main.engine.storage(this, type, name, opts)
				break
			default:
				main.error('type-not-implemented', type)
		}
	};

	main.config = {
		defaultNames: {
			db: '_'
		},
		regexp: /^[a-z0-9_$]+$/i
	}

	main.warning = function (label, contents) {
		console.error('[' + label + ']', contents || '')
	}

	main.error = function (label, contents) {
		console.error('[' + label + ']', contents || '')
		throw '[' + label + ']'
	}

	main.clone = function (obj) {
		if (typeof obj !== 'object' || obj === null)
			return obj

		if (obj instanceof Array) {
			var arrayRet = []

			for (var i = 0; i < obj.length; i++)
				arrayRet.push(main.clone(obj[i]))

			return arrayRet
		}

		var ret = {}

		for (var p in obj)
			ret[p] = main.clone(obj[p])

		return ret
	}

	main.Table = function (columns) {
		this.__cols = columns
		this.__data = {}
		this.__idx = {}
		this.__last = 0

		Object.defineProperty(this, '__isModified', {
			enumerable: false,
			value: false,
			writable: true
		})

		this.__load = function (json) {
			var obj = typeof json === 'string' ? JSON.parse(json) : json

			if (typeof obj !== 'object' || !(obj.__cols instanceof Array) || typeof obj.__data !== 'object' || typeof obj.__idx !== 'object' || typeof obj.__last !== 'number')
				main.error('invalid-load-structure')

			this.__cols = obj.__cols
			this.__data = obj.__data
			this.__idx = obj.__idx
			this.__last = obj.__last
		}
		this.__indexRow = function (id, column) {
			if (typeof column === 'undefined') {
				for (var col in this.__idx)
					this.__indexRow(id, col)
				return
			}

			if (typeof this.__idx[column] === 'undefined')
				return

			var pos = this.__cols.indexOf(column)
			var key = JSON.stringify(this.__data[id][pos])

			if (typeof this.__idx[column][key] === 'undefined')
				this.__idx[column][key] = []

			this.__idx[column][key].push(id)
		}

		this.__deindexRow = function (id, column) {
			if (typeof column === 'undefined') {
				for (var col in this.__idx)
					this.__deindexRow(id, col)
				return
			}

			if (typeof this.__idx[column] === 'undefined')
				return

			var pos = this.__cols.indexOf(column)
			var key = JSON.stringify(this.__data[id][pos])
			var item = this.__idx[column][key].indexOf(id)

			this.__idx[column][key].splice(item, 1)
		}

		this.__rowObject = function (row) {
			var obj = {}

			for (var i = 0; i < this.__cols.length; i++)
				obj[this.__cols[i]] = row[i]

			return main.clone(obj)
		}

		this.__query = function (filter) {
			var ret = []

			if (typeof filter === 'undefined' || filter === null) {
				ret.push.apply(ret, Object.keys(this.__data))

				return ret
			}

			if (typeof filter === 'function') {
				for (var id in this.__data)
					if (filter(this.__rowObject(this.__data[id])))
						ret.push(id)

				return ret
			}

			if (typeof filter !== 'object' || filter instanceof Array)
				main.error('invalid-filter')

			for (var col in filter) {
				var isRegExp = filter[col] instanceof RegExp
				var tempRet = []

				if (typeof this.__idx[col] !== 'undefined') {
					for (var value in this.__idx[col]) {
						var testIdx = isRegExp ? filter[col].test(value) : JSON.parse(value) === filter[col]

						if (testIdx)
							tempRet.push.apply(tempRet, this.__idx[col][value])
					}

					ret.push(tempRet)
					continue
				}

				var pos = this.__cols.indexOf(col)

				// eslint-disable-next-line no-redeclare
				for (var id in this.__data) {
					var test = isRegExp ? filter[col].test(this.__data[id][pos]) : this.__data[id][pos] === filter[col]

					if (test)
						tempRet.push(parseInt(id))
				}

				ret.push(tempRet)
			}

			if (ret.length === 0)
				return ret

			return ret[0].filter(function (id) {
				var found = true

				for (var i = 1; i < ret.length; i++)
					found = found && ret[i].indexOf(id) !== -1

				return found
			})
		}

		this.index = function (column) {
			var pos = this.__cols.indexOf(column)

			if (pos === -1)
				main.error('undefined-column')

			this.__idx[column] = {}

			for (var id in this.__data)
				this.__indexRow(id, column)

			this.__isModified = true
		}

		this.insert = function (row) {
			if (row instanceof Array) {
				var ids = []

				for (var i = 0; i < row.length; i++)
					ids.push(this.insert(row[i]))

				return ids
			}

			var rowArray = []

			// eslint-disable-next-line no-redeclare
			for (var i = 0; i < this.__cols.length; i++)
				rowArray[i] = typeof row[this.__cols[i]] === 'undefined' ? null : row[this.__cols[i]]

			var id = ++this.__last
			this.__data[id] = rowArray

			this.__indexRow(id)

			this.__isModified = true

			return id
		}

		this.delete = function (filter) {
			var rows = this.__query(filter)

			if (rows.length === 0)
				return 0

			for (var i = 0; i < rows.length; i++) {
				this.__deindexRow(rows[i])
				delete this.__data[rows[i]]
			}

			this.__isModified = true

			return rows.length
		}

		this.update = function (filter, values) {
			var rows = this.__query(filter)

			if (rows.length === 0)
				return 0

			var columns = {}

			for (var col in values) {
				var pos = this.__cols.indexOf(col)

				if (pos !== -1)
					columns[col] = this.__cols.indexOf(col)
			}

			for (var i = 0; i < rows.length; i++) {
				var cur = this.__data[rows[i]]

				for (var p in columns) {
					this.__deindexRow(rows[i], p)
					cur[columns[p]] = typeof values[p] === 'function' ? values[p](cur[columns[col]]) : values[p]
					this.__indexRow(rows[i], p)
				}
			}

			this.__isModified = true

			return rows.length
		}

		this.select = function (filter) {
			var rows = this.__query(filter)
			var ret = []

			for (var i = 0; i < rows.length; i++)
				ret.push(this.__rowObject(this.__data[rows[i]]))

			return ret
		}
	}

	main.engine = {}

	// eslint-disable-next-line no-unused-vars
	main.engine.storage = function (db, type, name, opts) {
		var storage

		switch (type) {
			case 'local':
				storage = localStorage
				break
			case 'session':
				storage = sessionStorage
				break
			default:
				main.error('storage-not-supported', type)
		}

		db.name = name
		db.tables = {}

		for (var i = 0; i < storage.length; i++) {
			var key = storage.key(i)

			if (key.indexOf(name + '.') !== 0)
				continue

			try {
				var tableName = key.substring(key.indexOf('.') + 1)

				db.tables[tableName] = new main.Table()
				db.tables[tableName].__load(storage.getItem(key))
			}
			// eslint-disable-next-line no-unused-vars
			catch (e) {
				main.warning('invalid-table-structure', key)
			}
		}

		db.get = function (name) {
			return this.tables[name]
		}

		db.create = function (name, columns) {
			if (!main.config.regexp.test(name))
				main.error('invalid-table-name')

			if (this.tables[name])
				main.error('table-exists')

			if (!(columns instanceof Array))
				main.error('invalid-columns')

			var colNames = []

			for (var i = 0; i < columns.length; i++) {
				var colName = columns[i]

				if (!main.config.regexp.test(colName))
					main.error('invalid-column-name')

				if (colNames.indexOf(colName) !== -1)
					main.error('duplicate-column')

				colNames.push(colName)
			}

			this.tables[name] = new main.Table(columns)

			return this.tables[name]
		}

		db.commit = function () {
			var backup = {}

			try {
				for (var table in this.tables)
					if (this.tables[table].__isModified) {
						backup[table] = storage.getItem(this.name + '.' + table)
						storage.setItem(this.name + '.' + table, JSON.stringify(this.tables[table]))
					}
			}
			catch (e) {
				// eslint-disable-next-line no-redeclare
				for (var table in backup)
					storage.setItem(this.name + '.' + table, backup[table])

				main.error('commit-failed', e)
			}

			// eslint-disable-next-line no-redeclare
			for (var table in backup)
				this.tables[table].__isModified = false
		}

		db.rollback = function () {
			var backup = {}

			try {
				for (var table in this.tables)
					if (this.tables[table].__isModified) {
						backup[table] = JSON.stringify(this.tables[table])
						this.tables[table].__load(storage.getItem(this.name + '.' + table))
					}
			}
			catch (e) {
				// eslint-disable-next-line no-redeclare
				for (var table in backup)
					this.tables[table].__load(backup[table])

				main.error('rollback-failed', e)
			}

			// eslint-disable-next-line no-redeclare
			for (var table in backup)
				this.tables[table].__isModified = false
		}

		return db
	}

	return main
}()