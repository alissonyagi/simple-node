window.Database = function () {
	var main = function (type, name, schema, opts) {
		if (name && !main.config.regexp.test(name))
			main.error('invalid-database-name', name)

		if (!type)
			main.error('type-not-specified')

		if (!name)
			name = main.config.defaultNames.db

		if (!schema || typeof schema !== 'object')
			schema = {}

		this.opts = typeof opts !== 'object' ? {} : opts
		this.name = name
		this.type = type
		this.tables = {}

		var self = this

		this.ready = Promise.resolve().then(function () {
			return self.load()
		}).then(function () {
			return self.apply(schema)
		}).then(function () {
			return true
		}).catch(function (err) {
			main.error('loading-failed', err)
		})
	}

	main.prototype.schema = function () {
		var schema = {}

		for (var table in this.tables)
			schema[table] = {
				columns: this.tables[table].__cols.slice(),
				indexes: Object.keys(this.tables[table].__idx)
			}

		return schema
	}

	main.prototype.schema.serialize = function (schema) {
		return JSON.stringify(schema, Object.keys(schema).concat(['columns', 'indexes']).sort())
	}

	main.prototype.reset = function () {
		for (var table in this.tables)
			this.drop(table)
	}

	main.prototype.apply = function (schema) {
		var cur = this.schema()

		if (this.schema.serialize(cur) === this.schema.serialize(schema))
			return

		var self = this

		return Promise.resolve().then(function () {
			return self.reset()
		}).then(function () {
			for (var name in schema) {
				var table = self.create(name, schema[name].columns)

				for (var i = 0; i < schema[name].indexes.length; i++)
					table.index(schema[name].indexes[i])
			}

			return self.commit()
		}).catch(function (err) {
			Promise.resolve(self.rollback()).then(function () {
				main.error('invalid-schema', err)
			})
		})
	}

	main.prototype.load = function () {
		switch (this.type) {
			case 'local':
			case 'session':
				return main.engine.storage(this)
			case 'indexed':
				return main.engine.indexed(this)
				break
			default:
				main.error('type-not-implemented', this.type)
		}
	}

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

	main.prototype.get = function (name) {
		return this.tables[name]
	}

	main.prototype.create = function (name, columns) {
		if (!main.config.regexp.test(name))
			main.error('invalid-table-name')

		if (this.tables[name] && !this.tables[name].__isDropped)
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

	main.prototype.drop = function (name) {
		if (!main.config.regexp.test(name))
			main.error('invalid-table-name')

		if (!this.tables[name])
			main.error('table-not-found')

		this.tables[name].__isModified = true
		this.tables[name].__isDropped = true
		this.tables[name].__data = {}
		this.tables[name].__idx = {}
		this.tables[name].__last = 0
	}

	main.prototype.purge = function () {
		if (this.tables.length === 0)
			return

		var self = this

		Object.keys(this.tables).forEach(function (v) {
			self.drop(v)
		})

		this.commit()
	}

	main.Table = function (columns) {
		this.__cols = columns
		this.__data = {}
		this.__idx = {}
		this.__last = 0

		Object.defineProperty(this, '__isModified', {
			enumerable: false,
			value: true,
			writable: true
		})

		Object.defineProperty(this, '__isDropped', {
			enumerable: false,
			value: false,
			writable: true
		})
	}

	main.Table.prototype.__load = function (json) {
		var obj = typeof json === 'string' ? JSON.parse(json) : json

		if (typeof obj !== 'object' || !(obj.__cols instanceof Array) || typeof obj.__data !== 'object' || typeof obj.__idx !== 'object' || typeof obj.__last !== 'number')
			main.error('invalid-load-structure')

		this.__cols = obj.__cols
		this.__data = obj.__data
		this.__idx = obj.__idx
		this.__last = obj.__last
		this.__isDropped = false
	}

	main.Table.prototype.__indexRow = function (id, column) {
		if (typeof column === 'undefined') {
			for (var col in this.__idx)
				this.__indexRow(id, col)
			return
		}

		if (typeof this.__idx[column] === 'undefined')
			return

		var pos = this.__cols.indexOf(column)
		var key = JSON.stringify(this.__data[id][pos])

		if (typeof key === 'undefined' || key === null)
			return

		if (typeof this.__idx[column][key] === 'undefined')
			this.__idx[column][key] = []

		this.__idx[column][key].push(String(id))
	}

	main.Table.prototype.__deindexRow = function (id, column) {
		if (typeof column === 'undefined') {
			for (var col in this.__idx)
				this.__deindexRow(id, col)
			return
		}

		if (typeof this.__idx[column] === 'undefined')
			return

		var pos = this.__cols.indexOf(column)
		var key = JSON.stringify(this.__data[id][pos])
		var item = this.__idx[column][key].indexOf(String(id))

		if (item !== -1)
			this.__idx[column][key].splice(item, 1)
	}

	main.Table.prototype.__rowObject = function (row) {
		var obj = {}

		for (var i = 0; i < this.__cols.length; i++)
			obj[this.__cols[i]] = row[i]

		return main.clone(obj)
	}

	main.Table.prototype.__union = function (set, values) {
		if (!(set instanceof Set && values instanceof Array))
			return

		for (var value of values)
			set.add(value)
	}

	main.Table.prototype.__intersect = function (set, values) {
		if (!(set instanceof Set && values instanceof Array))
			return

		for (var value of set)
			if (values.indexOf(value) === -1)
				set.delete(value)
	}

	main.Table.prototype.__query = function (filter) {
		var ret = []

		if (typeof filter === 'number')
			return this.__data[filter] ? [filter] : ret

		if (filter instanceof Array) {
			var invalid = filter.some(function (v) {
				return typeof v !== 'string'
			})

			if (invalid)
				main.error('invalid-filter-array')

			var self = this

			return filter.filter(function (v) {
				return self.__data[v]
			})
		}

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

		if (typeof filter !== 'object')
			main.error('invalid-filter')

		var set = new Set()
		var first = true
		var normalized = {}

		for (var col in filter) {
			var join = first ? this.__union : this.__intersect
			var isRegExp = filter[col] instanceof RegExp

			normalized[col] = isRegExp ? filter[col] : JSON.stringify(filter[col])

			if (typeof this.__idx[col] !== 'undefined') {
				if (!isRegExp) {
					if (this.__idx[col][normalized[col]])
						join(set, this.__idx[col][normalized[col]])
					else
						set.clear()
				}
				else
					Object.keys(this.__idx[col]).filter(function (key) {
						return filter[col].test(key)
					}).forEach(function (v) {
						join(set, v)
					})

				first = false

				delete normalized[col]
			}
		}

		var target = first ? Object.keys(this.__data) : set

		for (var id of target) {
			var row = this.__data[id]

			for (var col in normalized) {
				var pos = this.__cols.indexOf(col)
				var isRegExp = filter[col] instanceof RegExp
				var success = isRegExp ? filter[col].test(row[pos]) : normalized[col] === JSON.stringify(row[pos])

				if (first && success) {
					set.add(id)
					first = false
				}

				if (!success) {
					set.delete(id)
					break
				}
			}
		}

		return Array.from(set)
	}

	main.Table.prototype.index = function (column) {
		var pos = this.__cols.indexOf(column)

		if (pos === -1)
			main.error('undefined-column')

		this.__idx[column] = {}

		for (var id in this.__data)
			this.__indexRow(id, column)

		this.__isModified = true
	}

	main.Table.prototype.deindex = function (column) {
		var pos = this.__cols.indexOf(column)

		if (pos === -1)
			main.error('undefined-column')

		if (typeof this.__idx[column] === 'undefined')
			return

		delete this.__idx[column]

		this.__isModified = true
	}

	main.Table.prototype.insert = function (row) {
		if (this.__isDropped)
			main.error('table-dropped')

		if (row instanceof Array) {
			var ids = []

			for (var i = 0; i < row.length; i++)
				ids.push(this.insert(row[i]))

			return ids
		}

		var rowArray = []

		for (var i = 0; i < this.__cols.length; i++)
			rowArray[i] = typeof row[this.__cols[i]] === 'undefined' ? null : main.clone(row[this.__cols[i]])

		var id = ++this.__last
		this.__data[id] = rowArray

		this.__indexRow(id)

		this.__isModified = true

		return id
	}

	main.Table.prototype.delete = function (filter) {
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

	main.Table.prototype.update = function (filter, values) {
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
				cur[columns[p]] = typeof values[p] === 'function' ? values[p](this.__rowObject(cur)) : main.clone(values[p])
				this.__indexRow(rows[i], p)
			}
		}

		this.__isModified = true

		return rows.length
	}

	main.Table.prototype.merge = function (filter, values) {
		var updated = this.update(filter, values)

		if (updated > 0)
			return updated

		var complete = {}

		for (var p in filter)
			complete[p] = filter[p]

		for (var p in values)
			complete[p] = values[p]

		this.insert(complete)

		return 1
	}

	main.Table.prototype.select = function (filter) {
		var rows = this.__query(filter)
		var ret = []

		for (var i = 0; i < rows.length; i++) {
			var row = this.__rowObject(this.__data[rows[i]])
			row.rowid = parseInt(rows[i])
			ret.push(row)
		}

		return ret
	}

	main.Table.prototype.first = function (filter) {
		var rows = this.__query(filter)

		if (rows.length === 0)
			return null

		var row = this.__rowObject(this.__data[rows[0]])
		row.rowid = parseInt(rows[0])

		return row
	}

	main.Table.prototype.last = function (filter) {
		var rows = this.__query(filter)

		if (rows.length === 0)
			return null

		var pos = rows.length - 1
		var row = this.__rowObject(this.__data[rows[pos]])
		row.rowid = parseInt(rows[pos])

		return row
	}

	main.Table.prototype.count = function (filter) {
		var rows = this.__query(filter)

		return rows.length
	}

	main.engine = {}

	// eslint-disable-next-line no-unused-vars
	main.engine.storage = function (db) {
		var storage

		switch (db.type) {
			case 'local':
				storage = localStorage
				break
			case 'session':
				storage = sessionStorage
				break
			default:
				main.error('storage-not-supported', db.type)
		}

		for (var i = 0; i < storage.length; i++) {
			var key = storage.key(i)

			if (key.indexOf(db.name + '.') !== 0)
				continue

			try {
				var tableName = key.substring(key.indexOf('.') + 1)

				db.tables[tableName] = new main.Table()
				db.tables[tableName].__load(storage.getItem(key))
				db.tables[tableName].__isModified = false
			}
			// eslint-disable-next-line no-unused-vars
			catch (e) {
				main.warning('invalid-table-structure', key)
			}
		}

		db.commit = function () {
			var backup = {}
			var drop = []

			try {
				for (var table in this.tables) {
					if (!this.tables[table].__isModified)
						continue

					var key = this.name + '.' + table

					if (this.tables[table].__isDropped)
						drop.push(table)

					backup[table] = storage.getItem(key)

					if (this.tables[table].__isDropped && backup[table])
						storage.removeItem(key)
					else
						storage.setItem(key, JSON.stringify(this.tables[table]))
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

			for (var i = 0; i < drop.length; i++)
				delete this.tables[drop[i]]
		}

		db.rollback = function () {
			var backup = {}
			var drop = []

			try {
				for (var table in this.tables) {
					if (!this.tables[table].__isModified)
						continue

					var old = storage.getItem(this.name + '.' + table)

					if (!old) {
						drop.push(table)
						continue
					}

					backup[table] = JSON.stringify(this.tables[table])
					this.tables[table].__load(old)
				}
			}
			catch (e) {
				// eslint-disable-next-line no-redeclare
				for (var table in backup)
					this.tables[table].__load(backup[table])

				main.error('rollback-failed', e)
			}

			for (var i = 0; i < drop.length; i++)
				delete this.tables[drop[i]]

			// eslint-disable-next-line no-redeclare
			for (var table in backup)
				this.tables[table].__isModified = false
		}

		return true
	}

	main.engine.indexed = function (db) {
		var storeName = 'tables'
		var instance = indexedDB.open(db.name, db.opts.version || 1)

		instance.onupgradeneeded = function (evt) {
			var idb = evt.target.result

			if (!idb.objectStoreNames.contains(storeName))
				idb.createObjectStore(storeName, { keyPath: 'name' })
		}

		db.commit = function () {
			if (!instance || !instance.result || !instance.result.transaction)
				main.error('invalid-instance')

			var transaction = instance.result.transaction([storeName], 'readwrite')
			var tables = transaction.objectStore(storeName)
			var commit = []
			var drop = []

			return new Promise(function (resolve, reject) {
				transaction.oncomplete = function () {
					for (var i = 0; i < commit.length; i++)
						db.tables[commit[i]].__isModified = false

					for (var i = 0; i < drop.length; i++)
						delete db.tables[drop[i]]

					resolve(true)
				}

				transaction.onabort = function (evt) {
					reject('commit-aborted')
				}

				transaction.onerror = function (evt) {
					reject(evt.target.error)
				}

				for (var table in db.tables) {
					if (!db.tables[table].__isModified)
						continue

					db.tables[table].name = table

					commit.push(table)

					if (db.tables[table].__isDropped) {
						drop.push(table)
						tables.delete(table)
					}
					else
						tables.put(db.tables[table])
				}
			}).catch (function (err) {
				main.error('commit-failed', err)
			})
		}

		db.rollback = function () {
			if (!instance || !instance.result || !instance.result.transaction)
				main.error('invalid-instance')

			var transaction = instance.result.transaction([storeName], 'readonly')
			var tables = transaction.objectStore(storeName)
			var backup = {}
			var rollback = []
			var drop = []

			return new Promise(function (resolve, reject) {
				transaction.oncomplete = function () {
					for (var i = 0; i < drop.length; i++)
						delete db.tables[drop[i]]

					for (var table in backup)
						db.tables[table].__isModified = false

					resolve(true)
				}

				transaction.onabort = function (evt) {
					for (var table in backup)
						db.tables[table].__load(backup[table])

					reject('rollback-aborted')
				}

				transaction.onerror = function (evt) {
					for (var table in backup)
						db.tables[table].__load(backup[table])

					reject(evt.target.error)
				}

				for (var table in db.tables) {
					if (!db.tables[table].__isModified)
						continue

					(function (table) {
						var req = tables.get(table)

						req.onsuccess = function (evt) {
							if (!evt.target.result) {
								drop.push(table)
								return
							}

							backup[table] = JSON.stringify(db.tables[table])
							db.tables[table].__load(evt.target.result)
						}
					})(table)
				}
			}).catch (function (err) {
				for (var table in backup)
					db.tables[table].__load(backup[table])

				main.error('rollback-failed', err)
			})
		}

		return new Promise(function (resolve, reject) {
			instance.onsuccess = function (evt) {
				var idb = evt.target.result

				idb.onversionchange = function () {
					idb.close()
					main.warning('database-version-changed')
				}

				var transaction = idb.transaction([storeName], 'readonly')

				var tablesReq = transaction.objectStore(storeName).getAll()

				tablesReq.onsuccess = function () {
					var tables = tablesReq.result

					for (var i = 0; i < tables.length; i++) {
						try {
							db.tables[tables[i].name] = new main.Table()
							db.tables[tables[i].name].__load(tables[i])
							db.tables[tables[i].name].__isModified = false
						}
						catch (e) {
							main.warning('invalid-table-structure', key)
						}
					}

					resolve(true)
				}

				tablesReq.onerror = function (evt) {
					reject(evt.target.error)
				}
			}

			instance.onerror = function (evt) {
				reject(evt.target.error)
			}
		}).catch(function (err) {
			main.error('database-error', e)
		})
	}

	return main
}()
