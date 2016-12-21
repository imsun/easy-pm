const fs = require('fs-promise')
const path = require('path')
const shell = require('shelljs')
const pm2 = require('pm2')
const username = require('username')
const resolveHome = require('./resolveHome')

const homeDir = resolveHome('~/.easy-pm')
const configsFile = path.resolve(homeDir, './configs')

const configsScriptPath = path.resolve(__dirname, './configs.js')
const setupScriptPath = path.resolve(__dirname, './setup.js')

module.exports = { start }

function start(relConfigPath) {
	const isRoot = process.getuid() === 0

	const configPath = path.resolve(process.cwd(), resolveHome(relConfigPath))

	username()
		.then(name => {
			const rootPrefix = isRoot ? `sudo -u ${name}` : ''
			shell.exec(`${rootPrefix} node ${configsScriptPath} add ${configPath}`)
			shell.exec(`${rootPrefix} node ${setupScriptPath}`)
		})
		.then(() => fs.readFile(configsFile, 'utf8'))
		.then(configsStr =>{
			const configs = configsStr.split('\n').filter(s => !/^\s*$/.test(s))
			return new Promise((resolve, reject) => {
				pm2.connect(err => {
					if (err) {
						console.log(err)
						process.exit(2)
					}

					pm2.start({
						name: 'easy-pm-server',
						script: './server.js',
						watch: [configsFile].concat(configs)
					}, err => {
						pm2.disconnect()
						if (err) reject(err)
						else resolve(configs)
					})
				})
			})
		})
		.then(configs => {
			return Promise.all(configs.map(configPath => fs.readFile(configPath, 'utf8')))
		})
		.then(configStrs => configStrs.map(configStr => JSON.parse(configStr)))
		.then(configs => {
			configs.forEach(config => {
				console.log(`Listening on port ${config.port || 80}: ${config.apps.length} ${config.apps.length > 1 ? 'apps' : 'app'} running`)
			})
			const pmTable = shell.exec('npm run pm2 list', { silent: true })
			console.log(pmTable.stdout.replace(/>.*?\n/g, '').trim())
		})
}