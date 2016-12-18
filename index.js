const http = require('http')
const path = require('path')
const request = require('request')
const shell = require('shelljs')
const pm2 = require('pm2')
const proxy = require('http-proxy').createProxyServer({})
const config = require('./config')

config.root = config.root || ''
const hooksRe = new RegExp(`^(.*?//)*${config.host}/webhook`, 'i')
const GITHUB_API_HOST = 'http://api.github.com'
const headers = {
	'User-Agent': 'easy-pm',
	'Accept': 'application/vnd.github.v3+json'
}
if (config.token) {
	headers.Authorization = `token ${config.token}`
}

const routes = {}

const apps = config.apps.map(app => {
	const appPath = path.resolve(config.root, app.path)
	const port = app.port || ''
	const files = shell.ls(appPath)

	if (app.domains) {
		app.domains.forEach(domain => {
			routes[domain] = port
		})
	}

	if (files.stderr !== null) {
		if (app.repository) {
			app.branch = app.branch || 'master'
			shell.exec(`git clone ${app.repository} ${appPath} && cd ${appPath} && git checkout ${app.branch} && npm install`)
		} else {
			console.log(`Can't find ${appPath}`)
		}
	}

	if (app.repository) {
		const [, owner, repo] = app.repository.match(/.*?github\.com.(.+?)\/(.+?)\.git/)

		if (owner && repo) {
			request({
				headers,
				url: `${GITHUB_API_HOST}/repos/${owner}/${repo}/hooks`
			}, (err, res, body) => {
				try {
					const hooks = JSON.parse(body)
					const haveHooks = hooks.reduce((prev, current) => {
						return prev || hooksRe.test(current.config.url)
					}, false)
					if (!haveHooks) {
						request({
							headers,
							method: 'POST',
							url: `${GITHUB_API_HOST}/repos/${owner}/${repo}/hooks`,
							json: {
								name: 'web',
								active: true,
								events: ['push'],
								config: {
									url: `${config.host}/webhook`,
									content_type: 'json'
								}
							}
						})
					}
				} catch (e) {}
			})
		}
	}

	return {
		name: app.path,
		cwd: appPath,
		script: 'npm',
		args: 'start',
		watch: true,
		env: {
			PORT: port
		}
	}
})

http.createServer((req, res) => {
	const host = req.headers.host.split(':')[0]
	if (routes[host]) {
		proxy.web(req, res, {
			target: `http://127.0.0.1:${routes[host]}`
		})
	} else {
		console.log(req.headers)
		res.end()
	}
}).listen(process.env.PORT || 3000)

console.log(apps)
console.log(routes)

pm2.connect(function(err) {
	if (err) {
		console.log(err)
		process.exit(2)
	}

	pm2.start({ apps }, function(err, apps) {
		pm2.disconnect()
		if (err) throw err
	})
})
