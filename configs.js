const fs = require('fs-promise')
const path = require('path')
const program = require('commander')
const resolveHome = require('./resolveHome')

const homeDir = resolveHome('~/.easy-pm')
const configsFile = path.resolve(homeDir, './configs')

program
	.command('add <configPath>')
	.action(configPath => {
		fs.exists(homeDir)
			.then(exists => {
				if (exists) {
					return Promise.resolve()
				} else {
					return fs.mkdir(homeDir)
				}
			})
			.then(() => fs.appendFile(configsFile, '', 'utf8'))
			.then(() => fs.readFile(configsFile, 'utf8'))
			.then(configsStr => {
				const configs = configsStr.split('\n').filter(s => !/^\s*$/.test(s))
				if (configs.length <= 0) {
					return fs.appendFile(configsFile, `${configPath}`, 'utf8')
				} else if (configs.indexOf(configPath) < 0) {
					return fs.appendFile(configsFile, `\n${configPath}`, 'utf8')
				} else {
					return Promise.resolve()
				}
			})
			.catch(e => {
				console.log(e)
			})
	})

program.parse(process.argv)