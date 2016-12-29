const fs = require('fs-promise')
const path = require('path')
const program = require('commander')
const resolveHome = require('./resolveHome')

const homeDir = resolveHome('~/.easy-pm')
const configsFile = path.resolve(homeDir, './configs')

program
	.command('add <configPath>')
	.action(configPath => {
		fs.readFile(configPath)
			.then(() => fs.exists(homeDir))
			.then(exists => {
				if (exists) {
					return Promise.resolve()
				} else {
					return fs.mkdir(homeDir)
				}
			})
			.then(() => fs.appendFile(configsFile, '', 'utf8'))
			.then(() => fs.readFile(configsFile, 'utf8'))
			.then(configPathsStr => {
				const configPaths = configPathsStr.split('\n').filter(s => !/^\s*$/.test(s))
				if (configPaths.length <= 0) {
					return fs.writeFile(configsFile, `${configPath}`, 'utf8')
				} else if (configPaths.indexOf(configPath) < 0) {
					return fs.appendFile(configsFile, `\n${configPath}`, 'utf8')
				} else {
					return Promise.resolve()
				}
			})
			.catch(e => {
				console.log(e)
			})
	})

program
	.command('delete <configPath>')
	.action(configPath => {
		fs.readFile(configsFile, 'utf8')
			.then(configPathsStr => {
				const re = new RegExp(`(^|\n)${configPath}($|\n)`)
				const paths = configPathsStr.replace(re, '$2')
				return fs.writeFile(configsFile, paths, 'utf8')
			})
	})

program.parse(process.argv)