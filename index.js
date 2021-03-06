const fs = require('fs-promise')
const path = require('path')
const crypto = require('crypto')
const pm2 = require('pm2')
const Table = require('cli-table')
const username = require('username')

const manager = require('./lib/manager')
const { resolveHome, uuid } = require('./lib/utils')
const { configsFile, startFlagFile } = require('./lib/paths')

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
	const configPath = path.resolve(process.cwd(), resolveHome(relConfigPath))
	return manager.deleteAll()
		.then(() => manager.addConfig(configPath))
		.then(() => manager.setup())
		.then(() => console.log('\nStarting easy-pm-server...'))
		.then(() => fs.writeFile(startFlagFile, '1', 'utf8'))
		.then(() => manager.startAll())
		.then(configPaths => new Promise((resolve, reject) => {
			pm2.connect(err => {
				if (err) return reject(err)

				pm2.start({
					name: 'easy-pm-server',
					script: './task/server.js',
					watch: configPaths,
					env: {
						epm_server: true
					}
				}, err => {
					pm2.disconnect()
					if (err) reject(err)
					else resolve()
				})
			})
		}))
		.then(() => {
			console.log('easy-pm-server started.\n')
			return list()
		})
}

function stop(relConfigPath) {
	console.log('Stopping applications...')
	const configPath = path.resolve(process.cwd(), resolveHome(relConfigPath))
	manager.deleteConfig(configPath)
		.then(() => new Promise((resolve, reject) => {
			pm2.connect(err => {
				if (err) return reject(err)

				pm2.list((err, apps) => {
					if (err) return reject(err)
					resolve(apps)
				})
			})
		}))
		.then(apps => new Promise(resolve => {
			const epmServer = apps.find(app => app.pm2_env.epm_server)
			if (epmServer) {
				sendMessage(epmServer.pm_id, {
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
					const name = app.pm2_env.epm_name
					const branch = app.pm2_env.epm_branch
					const configPath = app.pm2_env.epm_config_path
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