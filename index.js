const path = require('path')
const shell = require('shelljs')
const pm2 = require('pm2')
const username = require('username')

const config = require('./config')
config.root = config.root || ''
const port = process.env.PORT || config.port || 80

const apps = config.apps.map(app => ({
	name: app.name,
	cwd: path.resolve(config.root, app.path || app.name),
	script: 'npm',
	args: 'start',
	watch: true,
	env: {
		PORT: app.port
	}
}))

username().then(name => {
	const isRoot = process.getuid() === 0
	const rootPrefix = isRoot ? `sudo -u ${name}` : ''

	const args = process.argv
	const interpreter = args.shift()
	const initScriptPath = path.resolve(args.shift(), '../init.js')
	shell.exec(`${rootPrefix} ${interpreter} ${initScriptPath} ${args.join(' ')}`)

	pm2.connect(err => {
		if (err) {
			console.log(err)
			process.exit(2)
		}

		pm2.start({
			apps: apps.concat({
				name: 'easy-pm-server',
				script: './server.js',
				watch: './config.js',
				env: process.env
			})
		}, err => {
			console.log(`Listening on port ${port}`)
			console.log(`${apps.length} ${apps.length > 1 ? 'apps' : 'app'} running`)
			const pmTable = shell.exec('npm run pm2 list', { silent: true })
			console.log(pmTable.stdout.replace(/>.*?\n/g, '').trim())
			pm2.disconnect()
			if (err) throw err
		})
	})
})