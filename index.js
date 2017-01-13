const fs = require('fs-promise')
const path = require('path')
const crypto = require('crypto')
const shell = require('shelljs')
const pm2 = require('pm2')
const Table = require('cli-table')
const username = require('username')
const { resolveHome, uuid } = require('./lib/_')

const homeDir = resolveHome('~/.easy-pm')
const configsFile = path.resolve(homeDir, './configs')
const startFlagFile = path.resolve(homeDir, './start_flag')

const configsScriptPath = path.resolve(__dirname, './configs.js')
const setupScriptPath = path.resolve(__dirname, './setup.js')

module.exports = { start, list, stop }

const __msgListeners = {}
const sendMessage = (id, msg) => {
	const msgId = uuid()
	return new Promise((resolve, reject) => {
		// There are some mistakes in PM2 API doc
		// Check:
		//   - https://github.com/Unitech/pm2/issues/2070
		//   - /node_modules/pm2/lib/God/ActionMethods.js `God.sendDataToProcessId`
		pm2.sendDataToProcessId(id, {
			id,
			data: {
				msg,
				id: msgId
			},
			type: 'process:msg',
			topic: 'stupid pm2'
		}, err => {
			if (err) return reject(err)
			__msgListeners[msgId] = resolve
		})
	})
}
pm2.launchBus((err, bus) => {
	bus.on('process:msg', packet => {
		if (__msgListeners[packet.data.id]) {
			__msgListeners[packet.data.id](packet.data.res)
			__msgListeners[packet.data.id] = undefined
		}
	})
})

function start(relConfigPath) {
	const isRoot = process.getuid() === 0

	const configPath = path.resolve(process.cwd(), resolveHome(relConfigPath))
	let configPaths = []
	return new Promise((resolve, reject) => {
		pm2.connect(err => {
			if (err) return reject(err)

			pm2.list((err, apps) => {
				if (err) return reject(err)
				resolve(apps)
			})
		})
	})
		.then(apps => Promise.all(
			apps.filter(app => app.pm2_env.epm_config_path)
				.map(app => new Promise((resolve, reject) => {
					pm2.delete(app.pm_id, err => {
						if (err) return reject(err)
						resolve()
					})
				}))
		))
		.then(() => pm2.disconnect())
		.then(() => username())
		.then(name => {
			const rootPrefix = isRoot ? `sudo -u ${name}` : ''
			shell.exec(`${rootPrefix} node ${configsScriptPath} add ${configPath}`)
			shell.exec(`${rootPrefix} node ${setupScriptPath}`)
			console.log('\nStarting easy-pm-server...')
		})
		.then(() => fs.writeFile(startFlagFile, '1', 'utf8'))
		.then(() => fs.readFile(configsFile, 'utf8'))
		.then(configsStr => {
			configPaths = configsStr.split('\n').filter(s => !/^\s*$/.test(s))
			return Promise.all(configPaths.map(configPath => {
				return fs.readFile(configPath, 'utf8')
					.then(configStr => {
						const config = JSON.parse(configStr)
						const root = path.resolve(configPath, '..', resolveHome(config.root))
						const apps = config.apps.map(app => {
							const branch = app.branch || 'master'
							const configPathHash = crypto.createHash('sha1').update(configPath).digest('hex')
							app.env = Object.assign({
								epm_config_path: configPath,
								epm_server_port: config.port || 80,
								PORT: app.port
							}, app.env)
							return Object.assign({
								cwd: path.resolve(root, `${app.name}@${branch}`),
								script: 'npm',
								args: 'start',
								watch: true
							}, app, {
								name: `${app.name}-${branch}-${configPathHash}`
							})
						})

						return apps
					})
			}))
		})
		.then(appGroups => {
			const apps = appGroups.reduce((prev, appList) => prev.concat(appList), [])
			apps.push({
				name: 'easy-pm-server',
				script: './server.js',
				watch: configPaths,
				env: {
					epm_server: true
				}
			})

			return new Promise((resolve, reject) => {
				pm2.connect(err => {
					if (err) return reject(err)

					pm2.start({ apps }, err => {
						pm2.disconnect()
						if (err) reject(err)
						else resolve()
					})
				})
			})
		})
		.then(() => {
			console.log('easy-pm-server started.\n')
			return listByConfigs(configPaths)
		})
}

function stop(relConfigPath) {
	console.log('Stopping applications...')
	const isRoot = process.getuid() === 0
	const configPath = path.resolve(process.cwd(), resolveHome(relConfigPath))
	username()
		.then(name => {
			const rootPrefix = isRoot ? `sudo -u ${name}` : ''
			shell.exec(`${rootPrefix} node ${configsScriptPath} delete ${configPath}`)
			return new Promise((resolve, reject) => {
				pm2.connect(err => {
					if (err) return reject(err)

					pm2.list((err, apps) => {
						if (err) return reject(err)
						resolve(apps)
					})
				})
			})
		})
		.then(apps => new Promise(resolve => {
			const epmServer = apps.find(app => app.pm2_env.epm_server)
			if (epmServer) {
				sendMessage(app.pm_id, {
					command: 'stop',
					data: [configPath]
				})
					.then(res => resolve(apps))
			} else {
				resolve(apps)
			}
		}))
		.then(apps => Promise.all(
			apps
				.filter(app => app.pm2_env.epm_config_path === configPath)
				.map(app => new Promise((resolve, reject) => {
					pm2.delete(app.pm_id, err => {
						if (err) return reject(err)
						resolve()
					})
				}))
		))
		.then(() => {
			pm2.disconnect()
			console.log('Applications stopped.')
			list()
		})

}

function list() {
	return fs.readFile(configsFile, 'utf8')
		.then(configsStr => configsStr.split('\n').filter(s => !/^\s*$/.test(s)))
		.then(configPaths => listByConfigs(configPaths))
}

function listByConfigs(configPaths) {
	const configs = {}
	configPaths.forEach(configPath => {
		configs[configPath] = {
			table: new Table({
				head: ['Name', 'branch', 'pid', 'status', 'restart', 'cpu', 'memory'],
				style: {
					head: ['cyan', 'bold']
				}
			})
		}
	})
	return new Promise((resolve, reject) => {
		pm2.connect(err => {
			if (err) return reject(err)

			pm2.list((err, apps) => {
				pm2.disconnect()
				if (err) return reject(err)

				apps.forEach(app => {
					const configPath = app.pm2_env.epm_config_path
					const pmName = app.name.split('-')
					pmName.pop()
					const branch = pmName.pop()
					const name = pmName.join('-')
					const pid = app.pid || 'N/A'
					const status = app.pm2_env.status
					const restart = app.pm2_env.restart_time
					const cpu = app.monit.cpu + '%'
					let memory = app.monit.memory / 1024
					if (memory < 1024) {
						memory = memory.toFixed(1) + ' KB'
					} else if (memory < 1024 * 1024) {
						memory = (memory / 1024).toFixed(1) + ' MB'
					} else {
						memory = (memory / 1024 / 1024).toFixed(1) + ' GB'
					}

					if (configs[configPath]) {
						const rootRe = new RegExp(`/${name}$`)
						configs[configPath].port = configs.port || app.pm2_env.epm_server_port || 80
						configs[configPath].root = app.pm2_env.cwd.replace(rootRe, '') || ''
						configs[configPath].table.push({
							[name]: [branch, pid, status, restart, cpu, memory]
						})
					}
				})
				resolve()
			})
		})
	})
		.then(() => {
			configPaths.forEach(configPath => {
				const config = configs[configPath]
				const table = config.table
				console.log(`Config File: ${configPath}`)
				console.log(`App Directory: ${config.root}`)
				console.log(`Listening on port ${config.port || 80}: ${table.length} ${table.length > 1 ? 'apps' : 'app'} running`)
				console.log(table.toString())
				console.log('')
			})
		})
}