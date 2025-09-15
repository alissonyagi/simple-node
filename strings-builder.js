const fs = require('node:fs')
const path = require('node:path')
const util = require('node:util')
const { cwd } = require('node:process')
const { execSync } = require('node:child_process')

const lang = process.argv[2] || 'en_US'
const project = path.resolve(cwd(), process.argv[3] || '.')

console.log('Project:', path.basename(project))

let stringsFile = false

try {
	stringsFile = require.resolve(path.resolve(project, 'strings', lang))
	console.log('Strings found:', path.relative(project, stringsFile))
}
catch (e) {}

const list = stringsFile ? require(stringsFile) : {}

try {
	let rows = execSync('grep -RI --exclude-dir=node_modules -E "(str|translate)\\..+\\(" "' + project + '/"*', { encoding: 'utf8' }).split("\n")
	let missing = []

	for (let i = 0; i < rows.length; i++) {
		if (rows[i].length === 0)
			continue

		let [file, contents] = rows[i].split(':', 2)

		let name = path.relative(project, file).replace(/\.js$/, '')

		let matches = contents.matchAll(/(str|translate)\.(translate\(.+\)\.)?(fatal|error|warn|info|debug|trace|get)\([\\'\\"](?<label>[^\\'\\"]+)/g)

		list[name] = list[name] || {}

		for (let m of matches) {
			if (typeof list[name][m.groups.label] !== 'undefined')
				continue

			list[name][m.groups.label] = ''

			missing.push(name + ': ' + m.groups.label)
		}
	}

	if (missing.length === 0)
		return console.log('No missing strings found.')

	/*if (stringsFile)
		fs.copyFileSync(stringsFile, stringsFile + '.' + Date.now() + '.old')

	fs.writeFileSync(stringsFile, JSON.stringify(list, null, "\t"))*/

	console.log('Updated missing strings:')
	console.log(util.inspect(missing, { maxArrayLength: null }))
}
catch (e) {
	if (e.status === 1)
		return console.log('No strings found')

	console.log(e)
}
